// The database on Cloudflare: a DatabaseSync-compatible facade over a
// Durable Object's SQLite storage (ctx.storage.sql), so lib/db.ts and every
// module that calls db().prepare() keeps its synchronous code.
//
// Enabled by setting FLOWPLAN_CLOUD_DB=1 (the DO bootstrap sets the
// singleton before the Next handler runs; lib/db.ts's db() then returns it
// instead of opening the SQLite file).
//
// Differences from node:sqlite, all verified against workerd (cloud/spike.ts):
// - only one statement per sql.exec, so exec() splits multi-statement
//   strings (migrate() passes whole DDL scripts); the splitter understands
//   quotes, comments and BEGIN…END trigger bodies;
// - BEGIN/COMMIT/ROLLBACK are refused: transactions go through
//   storage.transactionSync (lib/db.ts's transaction() branches on it);
// - BLOB values come back as ArrayBuffer; converted to Uint8Array here;
// - run() builds { changes, lastInsertRowid } from changes() and
//   last_insert_rowid().
export type CloudDb = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    all: (...params: unknown[]) => Record<string, unknown>[];
    run: (...params: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
    iterate: (...params: unknown[]) => IterableIterator<Record<string, unknown>>;
  };
  transactionSync: <T>(fn: () => T) => T;
};

type SqlLike = {
  exec: (sql: string, ...params: unknown[]) => { toArray: () => Record<string, unknown>[]; rowsWritten?: number };
};

// Split a SQL script into single statements. Semicolons inside string
// literals, quoted identifiers, comments and BEGIN…END blocks (trigger
// bodies) do not split.
export function splitSql(script: string): string[] {
  const out: string[] = [];
  let current = "";
  let beginDepth = 0;
  const push = () => {
    if (current.trim()) out.push(current.trim());
    current = "";
  };
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    const rest = script.slice(i);
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = script.indexOf(ch, i + 1);
      current += ch + (end < 0 ? script.slice(i + 1) : script.slice(i + 1, end) + ch);
      i = end < 0 ? script.length : end;
      continue;
    }
    if (rest.startsWith("--")) {
      const end = script.indexOf("\n", i);
      current += rest.slice(0, end < 0 ? undefined : end - i);
      i = end < 0 ? script.length : end - 1;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = script.indexOf("*/", i + 2);
      i = end < 0 ? script.length : end + 1;
      continue;
    }
    const word = /^[A-Za-z_]+/.exec(rest)?.[0];
    if (word) {
      const upper = word.toUpperCase();
      if (upper === "BEGIN") beginDepth++;
      // CASE…END pairs nest inside trigger bodies; only an END that closes
      // the last opened block (CASE or BEGIN) may close the trigger.
      else if (beginDepth > 0 && upper === "CASE") beginDepth++;
      else if (beginDepth > 0 && upper === "END") beginDepth--;
      current += word;
      i += word.length - 1;
      continue;
    }
    if (word) {
      current += word;
      i += word.length - 1;
      continue;
    }
    if (ch === ";" && beginDepth === 0) {
      push();
      continue;
    }
    current += ch;
  }
  push();
  return out;
}

const fromRow = (row: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(row)) if (v instanceof ArrayBuffer) row[k] = new Uint8Array(v);
  return row;
};

export function createCloudDb(sql: SqlLike, transaction: <T>(fn: () => T) => T): CloudDb {
  const scalar = (query: string) => sql.exec(query).toArray()[0] as Record<string, number> | undefined;
  const statement = (source: string) => ({
    get(...params: unknown[]) {
      const rows = sql.exec(source, ...params).toArray();
      return rows.length ? fromRow(rows[0]) : undefined;
    },
    all(...params: unknown[]) {
      return sql.exec(source, ...params).toArray().map(fromRow);
    },
    run(...params: unknown[]) {
      sql.exec(source, ...params);
      const c = scalar("SELECT changes() AS c, last_insert_rowid() AS i")!;
      return { changes: c.c, lastInsertRowid: c.i };
    },
    *iterate(...params: unknown[]) {
      for (const row of sql.exec(source, ...params).toArray()) yield fromRow(row);
    },
  });
  return {
    exec(script: string) {
      for (const statement of splitSql(script)) sql.exec(statement);
    },
    prepare: statement,
    transactionSync: transaction,
  };
}

// Spike: can flowplan's schema live on Durable Object SQLite?
// Exercises exactly the SQLite features lib/db.ts relies on, against
// ctx.storage.sql, and reports what works.
import { createCloudDb } from "../lib/db-cloud";

export class Spike {
  sql: SqlStorage;
  tx: <T>(fn: () => T) => T;
  constructor(ctx: { storage: { sql: SqlStorage; transactionSync: <T>(fn: () => T) => T } }, _env: unknown) {
    this.sql = ctx.storage.sql;
    this.tx = (fn) => ctx.storage.transactionSync(fn);
  }
  shimCheck(): Response {
    const db = createCloudDb(this.sql, this.tx);
    const out: Record<string, unknown> = {};
    try {
      db.exec("DROP TABLE IF EXISTS sp_pages; DROP TABLE IF EXISTS sp_docs");
      db.exec("CREATE TABLE sp_pages(id TEXT PRIMARY KEY, title TEXT NOT NULL); CREATE TABLE sp_docs(page_id TEXT REFERENCES sp_pages(id) ON DELETE CASCADE, state BLOB, html TEXT DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP)");
      out.splitDdl = "ok";
      db.exec("CREATE TRIGGER sp_trg AFTER INSERT ON sp_docs BEGIN INSERT INTO sp_docs(page_id,state,html) SELECT NEW.page_id,NEW.state,NEW.html WHERE NOT EXISTS(SELECT 1 FROM sp_docs WHERE page_id=NEW.page_id AND rowid!=NEW.rowid); END");
      out.triggerCreated = "ok";
      db.prepare("INSERT INTO sp_pages(id,title) VALUES(?,?)").run("p1", "标题");
      const st = db.prepare("INSERT INTO sp_docs(page_id,state,html) VALUES(?,?,?)");
      const r1 = st.run("p1", new Uint8Array([1, 2, 3, 250]), "<p>你好</p>");
      const r2 = st.run("p1", new Uint8Array([9]), "<p>第二次</p>");
      out.triggerDedup = db.prepare("SELECT COUNT(*) AS n FROM sp_docs").get()?.n;
      const got = db.prepare("SELECT page_id, state, html FROM sp_docs WHERE page_id=?").get("p1");
      out.blobIsU8 = got?.state instanceof Uint8Array;
      out.blobBytes = Array.from((got?.state as Uint8Array) ?? []);
      out.html = got?.html;
      out.runResult = { changes: Number(r1.changes), lastId: Number(r1.lastInsertRowid), secondChanges: Number(r2.changes) };
      out.pragma = db.prepare("PRAGMA table_info(sp_docs)").all().map((c) => c.name);
      const txn = db.transactionSync(() => {
        db.prepare("INSERT INTO sp_pages(id,title) VALUES(?,?)").run("t1", "tx");
        throw new Error("rollback me");
      });
      out.unreachable = txn;
    } catch (e) {
      out.error = String(e).slice(0, 200);
    }
    out.pagesAfterRollback = db.prepare("SELECT COUNT(*) AS n FROM sp_pages").get()?.n;
    return Response.json(out);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/shim") return this.shimCheck();
    const checks: { name: string; ok: boolean; detail?: string }[] = [];
    const tryDo = async (name: string, fn: () => unknown) => {
      try {
        const detail = fn();
        checks.push({ name, ok: true, detail: JSON.stringify(detail)?.slice(0, 120) });
      } catch (e) {
        checks.push({ name, ok: false, detail: String(e).slice(0, 200) });
      }
    };

    tryDo("unixepoch()", () => this.sql.exec("SELECT unixepoch() AS t").toArray());
    tryDo("json_object", () => this.sql.exec("SELECT json_object('a',1,'b','x') AS j").toArray());
    tryDo("fts5 trigram", () =>
      this.sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS si USING fts5(page_id UNINDEXED,title,body,tokenize='trigram remove_diacritics 1')"),
    );
    tryDo("fts5 match", () => {
      this.sql.exec("INSERT INTO si(page_id,title,body) VALUES('p1','Hello','Projektplanung und Suche')");
      return this.sql.exec("SELECT page_id FROM si WHERE si MATCH 'Projekt'").toArray();
    });
    tryDo("trigger with subselect", () => {
      this.sql.exec("CREATE TABLE t1(id TEXT PRIMARY KEY, deleted_at TEXT)");
      this.sql.exec("CREATE TABLE dirty(page_id TEXT)");
      this.sql.exec("CREATE TRIGGER trg AFTER INSERT ON t1 BEGIN INSERT INTO dirty SELECT NEW.id WHERE NOT EXISTS(SELECT 1 FROM dirty WHERE page_id=NEW.id); END");
      this.sql.exec("INSERT INTO t1 VALUES('a',NULL)");
      return this.sql.exec("SELECT COUNT(*) AS n FROM dirty").toArray();
    });
    tryDo("PRAGMA table_info via prepare", () =>
      this.sql.prepare("PRAGMA table_info(t1)").toArray?.() ?? this.sql.exec("PRAGMA table_info(t1)").toArray(),
    );
    tryDo("BEGIN/COMMIT", () => {
      this.sql.exec("BEGIN");
      this.sql.exec("INSERT INTO t1 VALUES('b',NULL)");
      this.sql.exec("ROLLBACK");
      return this.sql.exec("SELECT COUNT(*) AS n FROM t1").toArray();
    });
    tryDo("AUTOINCREMENT last_row_id", () => {
      this.sql.exec("CREATE TABLE auto(id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
      this.sql.exec("INSERT INTO auto(v) VALUES('x')");
      return this.sql.exec("SELECT last_insert_rowid() AS id").toArray();
    });
    tryDo("foreign keys cascade", () => {
      this.sql.exec("CREATE TABLE parent(id TEXT PRIMARY KEY)");
      this.sql.exec("CREATE TABLE child(pid TEXT REFERENCES parent(id) ON DELETE CASCADE)");
      this.sql.exec("INSERT INTO parent VALUES('p'),('q')");
      this.sql.exec("INSERT INTO child VALUES('p'),('q')");
      this.sql.exec("DELETE FROM parent WHERE id='p'");
      return this.sql.exec("SELECT COUNT(*) AS n FROM child").toArray();
    });
    tryDo("blob roundtrip", () => {
      this.sql.exec("CREATE TABLE blobs(id TEXT PRIMARY KEY, state BLOB)");
      this.sql.exec("INSERT INTO blobs VALUES('b1', X'00FF10')");
      return this.sql.exec("SELECT typeof(state) AS t, length(state) AS n FROM blobs").toArray();
    });
    tryDo("indexed join", () => {
      this.sql.exec("CREATE TABLE u(id TEXT PRIMARY KEY, email TEXT)");
      this.sql.exec("CREATE INDEX idx_email ON u(email)");
      this.sql.exec("SELECT u.email FROM u JOIN t1 ON t1.id=u.id");
      return "ok";
    });

    // node:sqlite module itself (would let us reuse DatabaseSync directly,
    // if its file storage can persist somewhere — expected: ephemeral only)
    let nodeSqlite = "not imported";
    try {
      const { DatabaseSync } = await import("node:sqlite");
      const mem = new DatabaseSync(":memory:");
      mem.exec("CREATE TABLE m(x)");
      mem.prepare("INSERT INTO m VALUES(?)").run("hi");
      nodeSqlite = `node:sqlite works in-memory: ${JSON.stringify(mem.prepare("SELECT x FROM m").get())}`;
    } catch (e) {
      nodeSqlite = `node:sqlite failed: ${String(e).slice(0, 160)}`;
    }
    checks.push({ name: "node:sqlite module", ok: !nodeSqlite.includes("failed"), detail: nodeSqlite });

    tryDo("blob param type", () => {
      const r = this.sql.exec("SELECT b, typeof(b) AS t FROM pb WHERE id='k1'").toArray()[0] as Record<string, unknown>;
      return { t: r.t, ctor: (r.b as object)?.constructor?.name, isU8: r.b instanceof Uint8Array, len: (r.b as { length?: number })?.length };
    });
    tryDo("param binding", () => {
      this.sql.exec("CREATE TABLE pb(id TEXT PRIMARY KEY, n INTEGER, f REAL, b BLOB, t TEXT, x TEXT)");
      this.sql.exec("INSERT INTO pb VALUES(?,?,?,?,?,?)", "k1", 42, 1.5, new Uint8Array([1,2,3]), null, "txt");
      const row = this.sql.exec("SELECT * FROM pb").toArray()[0] as Record<string, unknown>;
      return { n: row.n, f: row.f, blobIsU8: row.b instanceof Uint8Array, tIsNull: row.t === null, txt: row.x };
    });
    tryDo("PRAGMA via exec", () => this.sql.exec("PRAGMA table_info(pb)").toArray().length);
    tryDo("cursor metadata", () => {
      const c = this.sql.exec("INSERT INTO pb VALUES(?,?,?,?,?,?)", "k2", 1, 1, null, null, null) as unknown as { rowsWritten?: number };
      return { rowsWritten: c.rowsWritten };
    });
    tryDo("changes()", () => this.sql.exec("SELECT changes() AS c, last_insert_rowid() AS id").toArray());

    return Response.json({ checks });
  }
}

export default {
  async fetch(req: Request, env: { DB: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/spike" || url.pathname === "/shim") {
      const stub = env.DB.get(env.DB.idFromName("main"));
      return stub.fetch("https://do" + url.pathname);
    }
    return new Response("flowplan spike — GET /spike");
  },
};

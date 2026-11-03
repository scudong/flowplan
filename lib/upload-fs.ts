// Sync access to the uploads working copy. On Node this is the uploads
// folder; on Cloudflare (FLOWPLAN_CLOUD_DB=1) it is a blobs table in the
// same Durable Object SQLite, reached through the database facade — the
// workers runtime has no writable filesystem. One interface everywhere, so
// the file code keeps its synchronous, transactional behaviour.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "./db";

export const onCloud = () => process.env.FLOWPLAN_CLOUD_DB === "1";
const dir = () => resolve(process.env.FLOWPLAN_DATA_DIR || "./data", "uploads");
const keyOk = (key: string) => /^[A-Za-z0-9_-]{1,100}$/.test(key);

function ensureBlobs() {
  db().exec(
    "CREATE TABLE IF NOT EXISTS cloud_blobs(key TEXT PRIMARY KEY, data BLOB NOT NULL)",
  );
}

export function readUpload(key: string): Uint8Array {
  if (!onCloud()) return readFileSync(resolve(dir(), key));
  if (!keyOk(key)) throw new Error(`ENOENT: upload ${key}`);
  const row = db().prepare("SELECT data FROM cloud_blobs WHERE key=?").get(key) as
    | { data?: Uint8Array }
    | undefined;
  if (!row) throw Object.assign(new Error(`ENOENT: upload ${key}`), { code: "ENOENT" });
  return row.data!;
}

export function uploadSize(key: string): number {
  if (!onCloud()) return statSync(resolve(dir(), key)).size;
  return readUpload(key).length;
}

// `exclusive` mirrors writeFileSync's "wx": an existing upload is an error.
export function writeUpload(key: string, data: Uint8Array, exclusive = false) {
  if (!onCloud()) {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(resolve(dir(), key), data, exclusive ? { flag: "wx" } : undefined);
    return;
  }
  if (!keyOk(key)) throw new Error(`Invalid upload key`);
  ensureBlobs();
  if (exclusive) db().prepare("INSERT INTO cloud_blobs(key,data) VALUES(?,?)").run(key, data);
  else
    db()
      .prepare("INSERT INTO cloud_blobs(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data")
      .run(key, data);
}

export function existsUpload(key: string): boolean {
  if (!onCloud()) return existsSync(resolve(dir(), key));
  if (!keyOk(key)) return false;
  ensureBlobs();
  return !!db().prepare("SELECT 1 FROM cloud_blobs WHERE key=?").get(key);
}

export function removeUpload(key: string) {
  if (!onCloud()) {
    rmSync(resolve(dir(), key), { force: true });
    return;
  }
  if (!keyOk(key)) return;
  db().prepare("DELETE FROM cloud_blobs WHERE key=?").run(key);
}

// Health probe for the storage check: ready when uploads can be stored.
export function uploadsReady() {
  if (!onCloud()) {
    mkdirSync(dir(), { recursive: true });
    return;
  }
  ensureBlobs();
  db().prepare("SELECT COUNT(*) FROM cloud_blobs").get();
}

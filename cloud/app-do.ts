// The whole app in one Durable Object: flowplan's database is synchronous
// SQLite (lib/db.ts), which only works where the DO's sync SQL storage
// lives. All dynamic requests funnel into this single "App" object; static
// assets are served by the worker straight from the ASSETS binding.
//
// The DO installs the DatabaseSync-compatible facade (lib/db-cloud.ts) as
// globalDb.flowplanCloudDb / flowplanCloudTx in its constructor, before any
// request handler runs — that is what switches lib/db.ts to cloud mode.
import { createCloudDb } from "../lib/db-cloud";
import worker from "../.open-next/worker.js";



type SqlState = {
  storage: {
    sql: Parameters<typeof createCloudDb>[0];
    transactionSync: <T>(fn: () => T) => T;
  };
};

export class App {
  private env: unknown;
  private ctx: unknown;
  private state: SqlState;
  constructor(state: SqlState, env: unknown) {
    this.state = state;
    this.env = env;
    // DOs get no ExecutionContext: rebuild the piece OpenNext needs.
    this.ctx = {
      waitUntil: (p: Promise<unknown>) => state.waitUntil(p),
      passThroughOnException: () => {},
    };
    this.installDb();
  }

  // The sql handle must be (re)bound inside a request context: after the
  // runtime restarts this object, a facade captured in the constructor can
  // refuse its first I/O ("on behalf of a different Durable Object").
  // Recreating the closures per request is cheap and always current.
  private installDb() {
    const g = globalThis as unknown as {
      flowplanCloudDb?: unknown;
      flowplanCloudTx?: unknown;
    };
    g.flowplanCloudDb = createCloudDb(this.state.storage.sql, (fn) =>
      this.state.storage.transactionSync(fn),
    );
    g.flowplanCloudTx = (fn: () => unknown) => this.state.storage.transactionSync(fn as never);
  }

  async fetch(request: Request): Promise<Response> {
    this.installDb();
    return (worker as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(
      request,
      this.env,
      this.ctx,
    );
  }
}

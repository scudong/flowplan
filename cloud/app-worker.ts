// The worker in front of the App DO: static assets go straight to the
// ASSETS binding (free, unlimited), every dynamic request is forwarded into
// the single App object where flowplan's synchronous database lives.
import worker from "../.open-next/worker.js";

export { App } from "./app-do";

export interface Env {
  APP: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // OpenNext's own static asset handling lives behind ASSETS; skip the DO
    // for build files and icons so reads never touch the database object.
    if (url.pathname.startsWith("/_next/static") || url.pathname === "/favicon.ico") {
      return worker.fetch(request, env, ctx);
    }
    const stub = env.APP.get(env.APP.idFromName("main"));
    return stub.fetch(request);
  },
};

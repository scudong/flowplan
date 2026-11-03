import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // No incremental cache: every dynamic request runs in the App DO and
  // reads through lib/db.ts directly; pages are dynamic.
  // (kviIncrementalCache etc. can be enabled later.)
});

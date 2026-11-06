// The Cloudflare Worker entry (`main` in wrangler.jsonc). It wraps the Worker
// that `opennextjs-cloudflare build` writes to .open-next/worker.js. See
// src/lib/cloudflare-worker.ts and deploy/cloudflare/README.md.
// @ts-expect-error: the OpenNext build creates this file, and it has no types.
import openNextWorker from "./.open-next/worker.js";
import { createWorker } from "./src/lib/cloudflare-worker";

export default createWorker(openNextWorker);

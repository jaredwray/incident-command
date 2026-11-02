// OpenNext configuration for Cloudflare Workers (`pnpm cf:build`).
// See deploy/cloudflare/README.md and https://opennext.js.org/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental (ISR) cache is configured: pages read live data and the app
// keeps its own in-process cache (CACHE_TTL). To cache ISR output, add an
// override such as
// `@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache`
// together with its R2 binding in wrangler.jsonc.
export default defineCloudflareConfig({});

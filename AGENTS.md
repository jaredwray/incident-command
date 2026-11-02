<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project guide for coding agents

- **Toolchain:** Node 24, pnpm, Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS v4, Biome, Vitest.
- **Before you finish:** run `pnpm lint`, `pnpm typecheck` and `pnpm vitest run --coverage`. Coverage of `src/` must stay at 100% (lines, branches, functions, statements).
- **Layout:**
  - `src/lib/domain`: types, zod input schemas, status and uptime logic (pure).
  - `src/lib/store`: `DocumentStore` interface, adapters (memory, Postgres, Mongo) and the `CachedStore` wrapper. New adapters must pass `test/store/contract.ts`.
  - `src/lib/services`: business logic and role checks. Pages, server actions and MCP tools call services; they never touch the store directly.
  - `src/lib/mcp`: MCP server (tools are registered per role) and the HTTP handler.
  - `src/lib/notifications`: airhorn notifier, templates and the signed webhook provider. airhorn is loaded lazily (it cannot load on Cloudflare Workers).
  - `src/app`: thin pages and route handlers. `src/app/manage/actions.ts` holds every portal server action.
  - `src/components`: presentational components. Colors come only from theme tokens (`bg-surface`, `text-muted`, `bg-operational`, …), never raw palette classes.
- **Conventions:** timestamps are ISO strings; ids are prefixed (`inc_`, `cmp_`, …); expected failures throw `AppError` subclasses from `src/lib/errors.ts`; portal actions redirect with `?notice=` / `?error=` flash messages.
- **Tests:** `test/**/*.test.ts` run in Node, `test/**/*.test.tsx` in jsdom with `next/headers` and `next/navigation` mocked (`test/ui/setup.ts`). Use `createTestContext()` (services) or `setupApp()` + `signIn()` (pages and actions).

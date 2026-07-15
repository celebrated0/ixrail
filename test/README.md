# test/

Test sources are excluded from the packaged `.vsix` (see [../src/README.md](../src/README.md) for why this repo snapshot doesn't include them).

The project uses [Vitest](https://vitest.dev/) (`npm test` / `npm run test:watch`), configured via `tsconfig.tests.json`. When adding sources back under `src/`, mirror the structure under `test/` (e.g. `src/mcp/server.ts` → `test/mcp/server.test.ts`) so `npm run typecheck` picks both up.

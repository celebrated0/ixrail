# src/

This directory intentionally does not contain TypeScript sources in this repository snapshot.

The repo was assembled from the packaged `ixrail-agentpay-0.2.6.vsix`, which ships the bundled `out/` build (`out/extension.js`, `out/mcp/server.js`, `out/mcp/httpBridge.js`, `out/mock-merchant/server.js`) rather than raw sources — that's the normal output of `vsce package`, which excludes `src/`, tests, and dev config.

`tsconfig.json`, `tsconfig.tests.json`, and `esbuild.js` at the repo root are the expected build configuration for this layout (matching the `npm run build` / `typecheck` / `watch` scripts in `package.json`), so that dropping in the original sources reproduces the bundle end to end. Expected entry points, based on `esbuild.js` and the bundled output:

- `src/extension.ts` — VS Code extension host (wallets, policy engine, sidebar webview, commands)
- `src/mcp/server.ts` — stdio MCP server
- `src/mcp/httpBridge.ts` — authenticated localhost broker
- `src/mock-merchant/server.ts` — sandbox demo merchant

See [README.md](../README.md#repository-contents) for more on why sources aren't included here, and [CONTRIBUTING.md](../CONTRIBUTING.md) for how to propose changes.

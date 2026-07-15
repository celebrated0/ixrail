# Contributing to ixrail AgentPay

Thanks for your interest in improving ixrail AgentPay. This document covers the basics for filing issues and submitting pull requests.

## Before you start

- Search [existing issues](https://github.com/ixrail/ixrail-agentpay/issues) to avoid duplicates.
- For anything touching wallets, key handling, or settlement logic, open an issue first to discuss the approach — this project moves real (or simulated) money, so changes here get extra scrutiny.
- Security issues should **not** be filed as public issues. See [SECURITY.md](SECURITY.md).

## Development setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

Open the `extension` folder in VS Code and press `F5` to launch an Extension Development Host with the extension loaded. See the [README](README.md#install-build-debug-and-package) for the full walkthrough, including the sandbox demo.

## Making changes

1. Fork the repo and create a branch from `main`.
2. Keep changes focused — one logical change per pull request.
3. Add or update tests for anything behavioral (`npm test`).
4. Run `npm run typecheck` and `npm test` before opening a PR; CI runs the same checks.
5. Update `README.md` and `CHANGELOG.md` if the change is user-facing.

## Pull request checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Docs/README/CHANGELOG updated if applicable
- [ ] No secrets, tokens, or private keys committed

## Code style

- TypeScript, strict mode. Follow the patterns already present in the codebase rather than introducing new conventions.
- Prefer small, well-named functions over large ones — this codebase deals with money movement, and readability matters more than cleverness.
- Avoid adding new runtime dependencies unless necessary; the MCP server and HTTP bridge are intentionally dependency-light.

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- VS Code version and OS
- Extension version
- Steps to reproduce
- Whether `ixrail.simulateSettlement` was enabled
- Relevant logs (with tokens/keys redacted)

## Questions

Open a [discussion](https://github.com/ixrail/ixrail-agentpay/discussions) or reach out via [ixrail.com](https://ixrail.com).

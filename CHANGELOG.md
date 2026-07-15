# Changelog

All notable changes to ixrail AgentPay are documented here.

## [0.2.6] - 2026-07-12

### Fixed

- Fixed the sidebar appearing frozen after "Create agent wallet": quick inputs launched from the webview now use `ignoreFocusOut`, so the Agent ID prompt and network picker no longer auto-dismiss when the panel keeps focus.
- Added a watchdog and window-focus recovery so the sidebar controls can never remain permanently disabled if a prompt is dismissed.

### Changed

- Refactored the sandbox mock merchant into an importable `createMerchantApp()` factory (it still self-starts when run directly) and added an end-to-end test covering create wallet -> policy -> x402 pay -> receipt verification, replay rejection, cap enforcement, revoke/restore, and developer approval.

## [0.2.5] - 2026-07-12

### Changed

- Redrew the ixrail mark as a clean, symmetric four-leaf pixel clover across every surface (Activity Bar SVG, sidebar header, and Marketplace icon), replacing the lopsided inherited glyph.
- Regenerated `media/icon.png` from the same geometry via a dependency-free renderer so all logos match exactly.

## [0.2.4] - 2026-07-12

### Fixed

- Restored a monochrome SVG Activity Bar icon so the container renders the ixrail mark instead of a blank gray square.
- Inlined the sidebar header logo so the panel no longer depends on loading an external image and always renders.

## [0.2.3] - 2026-07-12

### Fixed

- Replaced every rendered logo with the exact user-supplied PNG.
- Removed SVG and generated-image paths so builds can no longer alter or substitute the supplied artwork.

## [0.2.2] - 2026-07-12

### Fixed

- Made the Marketplace icon, generated PNG, Activity Bar mark, walkthrough art, and sidebar header use one consistent ixrail clover design.
- Replaced the separately drawn sidebar glyph with the canonical SVG so small-size rendering matches the full logo.

## [0.2.1] - 2026-07-12

### Fixed

- Rebuilt the ixrail mark as four distinct black pixel leaves with a clean central cutout.
- Bumped the extension version so VS Code replaces cached 0.2.0 artwork when the new VSIX is installed.

## [0.2.0] - 2026-07-12

### Added

- Reconstructed TypeScript source for the VS Code extension, wallet service, policy engine, x402 client, receipt store, authenticated broker, MCP server, and mock merchant.
- ixrail AgentPay Activity Bar sidebar with wallet creation, policy editing, x402 payment, receipt history, receipt verification, revocation, restoration, and broker controls.
- Guided sandbox setup for a Base Sepolia wallet, localhost policy, authenticated local broker, and managed mock merchant.
- Simulated Base Sepolia settlement through the `ixrail.simulateSettlement` setting.
- Real USDC ERC-20 transfer paths for Base Sepolia and explicitly enabled Base mainnet wallets.
- Per-transaction, UTC daily, and UTC monthly limits; approval thresholds; allow/block lists; spend reservations; and agent revocation.
- Canonically serialized, locally signed receipts with verification and replay-resistant mock-merchant proofs.
- Authenticated localhost HTTP tool API and standalone stdio MCP server.
- Dependency-free MCP JSON-RPC runtime with initialize, discovery, ping, and tool-call support.
- Unit tests for policy evaluation, receipt signing, storage migration, and broker authentication/validation.
- Complete local development, integration, security, and troubleshooting documentation.
- Black four-leaf pixel mark on warm cream, with Activity Bar, walkthrough, and Marketplace variants.
- Direct links to [ixrail.com](https://ixrail.com) in extension metadata, the sidebar, and Command Palette.

### Changed

- Renamed product-facing metadata, commands, settings, storage keys, receipts, UI, and documentation to ixrail AgentPay.
- Consolidated standalone storage under `~/.ixrail-agentpay/store.json`.
- Mainnet transfers now require `IXRAIL_ALLOW_MAINNET_PAYMENTS=1`.
- Local HTTP configuration uses `IXRAIL_HTTP_*` variables and rejects non-loopback hosts.

### Security

- Wallet and receipt signer keys use VS Code SecretStorage in the extension host.
- Broker tool routes require a timing-safe bearer-token match; health remains unauthenticated.
- Payment requirements, policy input, URLs, recipients, amounts, chains, and request bodies are validated before use.
- Webview content is escaped, payment spend is reserved before settlement, and failed settlement releases reservations.

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:05070d,100:1a2740&height=160&section=header&text=ixrail%20AgentPay&fontSize=42&fontColor=ffffff&animation=fadeIn&fontAlignY=38&desc=Wallets,%20budgets%20%26%20governed%20x402%20payments%20for%20AI%20agents&descAlignY=58&descSize=16" alt="ixrail AgentPay banner" width="100%" />

<img src="media/icon.png" alt="ixrail AgentPay" width="96" height="96" />

# ixrail AgentPay

<a href="https://marketplace.visualstudio.com/items?itemName=ixrail.ixrail">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=20&duration=2800&pause=900&color=05070d&center=true&vCenter=true&width=620&lines=Give+AI+agents+a+wallet+and+a+budget;Governed+x402+payment+rails;Signed%2C+replay-resistant+receipts;All+without+leaving+VS+Code" alt="Typing SVG" />
</a>

[![Version](https://img.shields.io/badge/version-0.2.6-05070d?style=for-the-badge)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-05070d?style=for-the-badge)](LICENSE)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-%5E1.85.0-05070d?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![Node](https://img.shields.io/badge/node-%3E%3D18-05070d?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![VS Code Marketplace](https://img.shields.io/badge/Marketplace-ixrail.ixrail-05070d?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=ixrail.ixrail)
[![Website](https://img.shields.io/badge/website-ixrail.com-05070d?style=for-the-badge&logo=googlechrome&logoColor=white)](https://ixrail.com)

[![TypeScript](https://img.shields.io/badge/TypeScript-05070d?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![x402](https://img.shields.io/badge/protocol-x402-05070d?style=flat-square)](#x402-behavior)
[![USDC](https://img.shields.io/badge/settlement-USDC-05070d?style=flat-square)](#real-usdc-caveats)
[![MCP](https://img.shields.io/badge/MCP-compatible-05070d?style=flat-square)](#mcp-usage)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-05070d?style=flat-square)](#contributing)
[![Made with](https://img.shields.io/badge/made%20with-%E2%9D%A4-05070d?style=flat-square)](https://ixrail.com)

</div>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:05070d,100:1a2740&height=3&section=header" width="100%" />



ixrail AgentPay is a VS Code extension that gives local AI agents a **wallet**, a **spending policy**, an **authenticated broker**, an **x402 payment flow**, and a **signed receipt ledger** — all without leaving the editor. It supports simulated Base Sepolia settlement for development and explicit on-chain USDC settlement for funded wallets.

🔗 Learn more at **[ixrail.com](https://ixrail.com)**

## Table of contents

- [Why ixrail AgentPay](#why-ixrail-agentpay)
- [Install, build, debug, and package](#install-build-debug-and-package)
- [Sidebar workflows](#sidebar-workflows)
- [Sandbox demo](#sandbox-demo)
- [Spending policy controls](#spending-policy-controls)
- [x402 behavior](#x402-behavior)
- [Authenticated localhost broker](#authenticated-localhost-broker)
- [MCP usage](#mcp-usage)
- [Environment variables](#environment-variables)
- [Real USDC caveats](#real-usdc-caveats)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Repository contents](#repository-contents)
- [Contributing](#contributing)
- [License](#license)

## Why ixrail AgentPay

Agent frameworks and MCP servers increasingly need to pay for the resources they consume — API calls, data, compute — without a human in the loop for every transaction. ixrail AgentPay brings that capability into VS Code with:

- 🔐 **Wallets** created and stored via VS Code `SecretStorage`
- 📊 **Spending policies** with per-transaction, daily, and monthly caps, an approval threshold, and allow/block lists
- 🌐 **An authenticated localhost broker** so local agents can call AgentPay tools over HTTP
- 🧾 **Signed, replay-resistant receipts** for every settled payment
- 🔌 **A dependency-free stdio MCP server** exposing the same tools to any MCP-compatible client
- 🧪 **A sandbox demo** — mock merchant, simulated settlement, and a guided walkthrough — so the full pay → receipt loop works with zero funds

## Install, build, debug, and package

The fastest way to get started is installing **ixrail AgentPay** from the VS Code Marketplace (extension ID `ixrail.ixrail`):

```bash
code --install-extension ixrail.ixrail
```

Or search for **ixrail AgentPay** in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`), or install directly from the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=ixrail.ixrail).

To build and run from source instead:

Requirements:

- Node.js 18 or newer
- npm
- VS Code 1.85 or newer

Install and verify the project:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Open this repository's `extension` folder in VS Code and press `F5` (or select **Run > Start Debugging**). The included launch configuration runs the build task and opens an Extension Development Host with ixrail AgentPay loaded.

For iterative development, run `npm run watch` and launch the Extension Development Host separately. To produce an installable VSIX:

```bash
npm run package
```

The package command runs `vscode:prepublish`, bundles the extension, MCP server, HTTP bridge, and mock merchant into `out`, and excludes source, tests, maps, development configuration, and dependencies from the VSIX.

> **Note on this repository's contents:** this repo currently ships the bundled `out/` output produced by the packaged `.vsix` (see [Repository contents](#repository-contents) below). If you have the original TypeScript sources, drop them into `src/` alongside the config files referenced in `package.json` (`esbuild.js`, `tsconfig.json`, `tsconfig.tests.json`) so the scripts above work end to end.

## Sidebar workflows

Open **ixrail AgentPay** from the Activity Bar. The sidebar shows wallet and policy counts, broker status, settlement mode, agent wallets, policy limits, access state, and recent receipts.

Typical workflow:

1. Choose **Create Agent Wallet**, enter an agent ID, and select `base-sepolia` for sandbox work or `base` for mainnet.
2. Choose **Set policy** on the agent. Configure per-transaction, UTC daily, and UTC monthly caps.
3. Set the human-approval threshold. Amounts at or above the threshold require a VS Code confirmation before settlement.
4. Optionally add merchant hostnames or recipient addresses to the allowlist and blocklist. An empty allowlist permits any merchant not blocked; the blocklist takes precedence.
5. Choose **Pay endpoint** and enter an HTTP or HTTPS x402 resource.
6. Inspect recent payments in the agent card or open **All receipts** for the signed ledger.
7. Use **Revoke access** to stop an agent immediately. Restoring access reapplies its saved policy.

The Command Palette exposes the same core actions under **ixrail AgentPay**, including receipt verification and broker start/stop.

Use **Open ixrail Website** from the Command Palette or **Visit ixrail.com** in the sidebar for product updates and documentation.

## Sandbox demo

The guided demo prepares a complete local sandbox without making a payment until you ask:

1. Choose **Set Up Sandbox Demo**. This creates the `sandbox-demo` Base Sepolia wallet if needed, applies a localhost-only policy, starts the authenticated broker and bundled mock merchant, and copies the broker bearer token.
2. Choose **Pay endpoint**, select `sandbox-demo`, and use `http://127.0.0.1:4021/v1/weather`.

With `ixrail.simulateSettlement` enabled (the default), the extension performs the complete policy, proof, retry, and signed-receipt flow without broadcasting a transaction or requiring funds. The returned transaction hash is synthetic. The mock merchant charges 0.05 USDC and rejects reuse of a receipt proof.

To test a real Base Sepolia USDC transfer, disable `ixrail.simulateSettlement`, fund the wallet with Base Sepolia USDC and enough Base Sepolia ETH for gas, then repeat the payment.

## Spending policy controls

Every attempted x402 settlement is evaluated before signing:

- **Per-transaction cap:** maximum for one payment.
- **Daily cap:** recorded spend plus active reservations for the current UTC day.
- **Monthly cap:** recorded spend plus active reservations for the current UTC month.
- **Approval threshold:** requests at or above this amount require explicit developer approval.
- **Allowlist:** normalized merchant domains or recipient addresses permitted to receive payments.
- **Blocklist:** normalized domains or addresses always denied.
- **Reservations:** approved spend is reserved for ten minutes to prevent concurrent requests from racing past a cap.
- **Revocation:** denies all payments for an agent and clears its active reservations.

Policies are local to the selected storage backend. Creating or updating a policy also restores a previously revoked agent.

## x402 behavior

`pay_x402_endpoint` first requests the resource normally. If the response is not HTTP 402, the response is returned without payment. For a 402 response, AgentPay accepts payment requirements at the response root or in `paymentRequirements` and validates:

- a positive numeric amount;
- the exact asset/currency `USDC`;
- a valid EVM recipient address;
- chain `base-sepolia` or `base`;
- a wallet on the same chain;
- the optional caller maximum and the agent policy.

After settlement, AgentPay signs a canonical receipt, retries the resource with `X-Payment-Proof` and `X-Ixrail-Receipt`, records spend, and returns the retry response. Receipt signatures prove the local receipt signer produced the payload; they are not themselves proof of on-chain finality.

## Authenticated localhost broker

Start the broker from the sidebar/Command Palette, or run the standalone bridge after building:

```bash
npm run build
npm run http-bridge
```

The bridge defaults to `127.0.0.1:4022`. If `IXRAIL_HTTP_TOKEN` is unset, it generates a random token and prints it once. Every `/tools/*` request must include:

```text
Authorization: Bearer <token>
Content-Type: application/json
```

`GET /health` is intentionally unauthenticated. The broker refuses non-loopback bind addresses.

Example HTTP calls:

```bash
curl http://127.0.0.1:4022/health

curl -X POST http://127.0.0.1:4022/tools/create_spending_policy \
  -H "Authorization: Bearer $IXRAIL_HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"sandbox-demo","perTxCapUsd":1,"dailyCapUsd":10,"monthlyCapUsd":100,"approvalThresholdUsd":0.5,"allowlist":["127.0.0.1"],"blocklist":[]}'

curl -X POST http://127.0.0.1:4022/tools/pay_x402_endpoint \
  -H "Authorization: Bearer $IXRAIL_HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"sandbox-demo","url":"http://127.0.0.1:4021/v1/weather","maxAmountUsd":0.10}'
```

Available HTTP routes are `/tools/get_balance`, `/tools/request_payment`, `/tools/pay_x402_endpoint`, `/tools/create_spending_policy`, `/tools/get_receipt`, and `/tools/revoke_agent_access`.

## MCP usage

The dependency-free stdio MCP server implements the MCP initialize, ping, tool discovery, and tool-call lifecycle for its six AgentPay tools. It uses the standalone file store:

```bash
npm run build
npm run mcp-server
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "ixrail-agentpay": {
      "command": "node",
      "args": ["C:/absolute/path/to/extension/out/mcp/server.js"],
      "env": {
        "IXRAIL_AGENTPAY_STORE": "C:/absolute/path/to/agentpay-store.json"
      }
    }
  }
}
```

The MCP transport is newline-delimited JSON-RPC over stdio and does not use the HTTP bearer token. Use **Copy MCP Configuration** from the extension to generate a client entry with the correct bundled path. Restrict who can launch the process and read its storage file.

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `IXRAIL_AGENTPAY_STORE` | JSON store used by standalone MCP/HTTP processes | `~/.ixrail-agentpay/store.json` |
| `IXRAIL_HTTP_HOST` | HTTP bridge host — only `127.0.0.1`, `::1`, and `localhost` are accepted | `127.0.0.1` |
| `IXRAIL_HTTP_PORT` | Broker/bridge port; overrides the VS Code `ixrail.brokerPort` setting | `4022` |
| `IXRAIL_HTTP_TOKEN` | Stable bearer token for the broker | random, generated if omitted |
| `IXRAIL_MOCK_MERCHANT_PORT` | Mock merchant port | `4021` |
| `IXRAIL_MOCK_MERCHANT_ADDRESS` | EVM recipient advertised by the mock merchant | — |
| `IXRAIL_BASE_SEPOLIA_RPC_URL` | Base Sepolia JSON-RPC endpoint | — |
| `IXRAIL_BASE_RPC_URL` | Base mainnet JSON-RPC endpoint | — |
| `IXRAIL_ALLOW_MAINNET_PAYMENTS=1` | Explicit opt-in required before Base mainnet USDC transfers | unset |

## Real USDC caveats

- Simulated settlement moves no tokens. A synthetic hash and locally signed receipt exercise the integration path only.
- On-chain mode transfers the native USDC contract token on Base Sepolia or Base. The wallet needs USDC plus ETH for gas.
- Amounts are represented as JavaScript numbers and rounded to six decimal places for the ERC-20 transfer. This build is intended for controlled developer workflows, not high-value treasury operations.
- `get_balance` currently reports native ETH for gas, not the USDC token balance.
- The extension uses locally generated EOA private keys. Mainnet is disabled unless `IXRAIL_ALLOW_MAINNET_PAYMENTS=1`, but enabling it permits real irreversible transfers that satisfy policy.
- An x402 server controls the payment requirements it returns. Use strict allowlists and low caps before connecting unfamiliar endpoints.
- Transaction submission does not wait for confirmations in this release; verify the transaction independently before treating it as final.

## Security

- VS Code-hosted wallet and receipt-signing keys use VS Code `SecretStorage`.
- The standalone file store keeps state and secrets in one local JSON file with restrictive file permissions where supported. Protect that file with operating-system access controls; it is not encrypted by AgentPay.
- The broker compares bearer tokens with a timing-safe comparison, limits JSON bodies to 64 KiB, removes the Express identification header, and binds only to loopback.
- Dynamic webview values are escaped before rendering.
- Policy evaluation and spend reservation occur before transfer; failed transfers release reservations.
- Signed receipts are canonicalized and independently verifiable, while the mock merchant also rejects proof replay.
- Treat broker tokens, wallet keys, the storage file, and receipt signer keys as secrets. Do not commit or paste them into logs.

If you discover a security issue, please report it privately rather than opening a public issue — see [ixrail.com](https://ixrail.com) for contact details.

## Troubleshooting

**The extension does not appear after F5**
Run `npm run build`, confirm the build succeeds, then use the **Run ixrail AgentPay Extension** launch configuration from this folder.

**Port 4021 or 4022 is already in use**
Set `IXRAIL_MOCK_MERCHANT_PORT` for the merchant or `IXRAIL_HTTP_PORT`/`ixrail.brokerPort` for the broker. Update the payment URL to match.

**401 Unauthorized from `/tools/*`**
Send the exact token as `Authorization: Bearer <token>`. Restarting without `IXRAIL_HTTP_TOKEN` generates a new token.

**Broker refuses its host**
Only loopback hosts are supported. Use `127.0.0.1`, `::1`, or `localhost`.

**Payment denied by policy**
Check revocation, allow/block lists, per-transaction cap, accumulated UTC daily/monthly spend, active reservations, and the caller's `maxAmountUsd`.

**Payment asks for approval**
The amount is at or above the policy threshold. HTTP and stdio standalone processes have no VS Code approval UI and deny approval-required settlement by default; adjust policy deliberately if unattended payment is intended.

**Base Sepolia transfer fails**
Disable simulation only when the wallet has Base Sepolia USDC and ETH for gas, the RPC endpoint works, and the merchant requirement specifies `base-sepolia`.

**Mainnet transfer is disabled**
This is intentional. Set `IXRAIL_ALLOW_MAINNET_PAYMENTS=1`, restart the process or Extension Development Host, and verify the wallet, recipient, caps, and network first.

**MCP and VS Code show different wallets**
They use different storage adapters by default. Point standalone MCP/HTTP processes at the same `IXRAIL_AGENTPAY_STORE`; VS Code SecretStorage is not directly shared with that file.

## Repository contents

```
.
├── out/                # Bundled extension, MCP server, HTTP bridge, and mock merchant (from the packaged .vsix)
├── media/              # Icon assets (Activity Bar SVG, Marketplace PNG)
├── package.json        # Extension manifest, contributes, scripts, dependencies
├── CHANGELOG.md         # Version history
├── LICENSE              # MIT license
└── README.md
```

This repository was assembled from the packaged `ixrail-agentpay-0.2.6.vsix`, which ships the bundled `out/` build rather than raw TypeScript sources (that's standard for a `vsce package` output — source, tests, and dev config are excluded). If you're publishing your original `src/`, tests, `esbuild.js`, and `tsconfig*.json`, add them alongside `out/` so `npm install && npm run build` reproduces this bundle from scratch.

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck` and `npm test` before opening a PR.

## License

[MIT](LICENSE) © 2026 ixrail — [ixrail.com](https://ixrail.com)

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:05070d,100:1a2740&height=100&section=footer" width="100%" />

⭐ **If ixrail AgentPay is useful to you, consider starring the repo!** ⭐
</div>

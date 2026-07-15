# Architecture overview

High-level map of how ixrail AgentPay's components fit together. See the [README](../README.md) for full behavioral detail on each.

## Components

| Component | Entry point | Runs as | Purpose |
| --- | --- | --- | --- |
| Extension host | `out/extension.js` | Loaded by VS Code | Sidebar UI, commands, wallet/policy storage via `SecretStorage`, orchestrates the other components |
| MCP server | `out/mcp/server.js` | Standalone Node process (stdio) | Exposes AgentPay tools to MCP-compatible clients over newline-delimited JSON-RPC |
| HTTP bridge / broker | `out/mcp/httpBridge.js` | Standalone Node process (loopback HTTP) | Bearer-token-authenticated HTTP access to the same tools, for local agents that speak HTTP instead of MCP |
| Mock merchant | `out/mock-merchant/server.js` | Standalone Node process (loopback HTTP) | Sandbox x402 resource used by the guided demo; charges 0.05 USDC and rejects proof replay |

## Data flow (x402 payment)

1. Agent (via MCP, HTTP broker, or a VS Code command) calls `pay_x402_endpoint` with a target URL.
2. AgentPay requests the resource. A non-402 response is returned as-is.
3. On HTTP 402, AgentPay validates the payment requirements (amount, asset, recipient, chain) against the agent's spending policy.
4. If approved, AgentPay reserves the spend, signs a payment, and (in simulated mode) fabricates a synthetic settlement, or (in real mode) broadcasts an on-chain USDC transfer.
5. AgentPay signs a canonical receipt and retries the original request with `X-Payment-Proof` / `X-Ixrail-Receipt` headers.
6. Spend is recorded against the policy's daily/monthly caps; the reservation is released.

## Storage backends

- **VS Code `SecretStorage`** — used when the extension host itself creates wallets/policies via the sidebar or Command Palette.
- **Standalone JSON file store** (`IXRAIL_AGENTPAY_STORE`, default `~/.ixrail-agentpay/store.json`) — used by the standalone MCP server and HTTP bridge when run outside VS Code.

These two backends are **not** automatically synced; see the README's [Troubleshooting](../README.md#troubleshooting) section for pointing standalone processes at the same store.

## Trust boundaries

- The HTTP bridge binds to loopback only and requires a bearer token on every `/tools/*` route.
- The MCP stdio server has no bearer-token layer — process launch itself is the trust boundary. Restrict who can start it and read its store file.
- x402 servers control the payment requirements they return; AgentPay validates structure and policy, but a malicious or compromised endpoint can still request payment. Allowlists and low caps are the mitigation, not payload validation alone.

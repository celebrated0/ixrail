# Security Policy

ixrail AgentPay handles wallet keys, spending policies, and payment settlement. Security issues here are treated as high priority.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately via the contact details at [ixrail.com](https://ixrail.com). Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept code if available)
- Affected version(s)
- Whether the issue affects simulated settlement, real on-chain settlement, or both

We aim to acknowledge reports within a few business days.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.x | ✅ |
| < 0.2 | ❌ |

## Scope

In scope:

- Wallet key generation, storage, and signing (`SecretStorage` usage, standalone file store)
- Spending policy enforcement (caps, allow/block lists, reservations, revocation)
- The x402 payment flow and receipt signing/verification
- The authenticated localhost broker (auth bypass, non-loopback binding, request smuggling)
- The MCP stdio server

Out of scope:

- Issues requiring physical access to an already-compromised machine
- Denial of service against the bundled mock merchant (sandbox-only component)
- Third-party RPC endpoint behavior

## Known design notes

See [Real USDC caveats](README.md#real-usdc-caveats) and [Security](README.md#security) in the README for documented tradeoffs (e.g., transaction submission does not wait for confirmations, `get_balance` reports ETH not USDC, mainnet requires explicit opt-in). These are known and documented, not vulnerabilities — but reports that reveal these behind unexpected conditions are still welcome.

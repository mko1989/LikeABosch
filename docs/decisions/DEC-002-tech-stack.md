# DEC-002: Tech stack: Node.js + plain JavaScript, no frontend framework

- **Status:** accepted (language/UI decided by user 2026-10-02; libraries proposed by Claude, same date); amended by DEC-008 (launcher has its own package.json); amended by DEC-012 (atem-connection dependency)
- **WO:** WO-001

## Decision
- **Runtime:** Node.js ≥ 22 (dev machine has v22.18), ES modules, plain JavaScript with JSDoc
  annotations (no TypeScript, no build step). *(user)*
- **Web UI:** plain HTML + CSS + browser ES modules, no framework, no bundler, served as static
  files by the backend. *(user)*
- **HTTP server:** Express 5.
- **WebSocket client to DICENTIS:** `ws` package. It supports subprotocol `DICENTIS_1_0` and
  `rejectUnauthorized: false`, which is needed because DICENTIS uses self-signed certificates by default.
- **Browser push from backend:** Server-Sent Events (native `EventSource`, no library).
- **Tests:** `node:test` + `node:assert/strict`.
- **Config:** environment variables / `.env` (loaded via Node's `--env-file`), runtime settings
  persisted in a gitignored `data/` dir.
- **Single `package.json` at repo root** (no workspaces) to keep tooling simple.

## Consequences
- Few dependencies: express, ws (+ dev-only nothing for now).
- Without a framework, the UI needs disciplined structure: one ES module per view and a small
  shared store/event-bus. That structure gets designed in the UI shell WO.

## Alternatives considered
- TypeScript, React/Vue/Svelte: declined by user.
- Fastify (built-in JSON schema validation): reasonable, but Express is more familiar; validation
  is generated from our own spec JSON anyway.
- Node's built-in global `WebSocket`: no simple per-connection TLS override for self-signed certs.

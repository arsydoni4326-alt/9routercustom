# 9Router Specification

_Last updated: 2026-08-16_

This document describes the functional and technical requirements of **9Router** (`9router-app`), the local AI routing gateway. It complements `docs/ARCHITECTURE.md` (how the system is built) and `docs/ROADMAP.md` (where it is going).

The standing project constraint is **lightweightness**: single-node, small-memory, no heavyweight runtime machinery, minimal dependencies. Every feature in this spec exists because it directly serves the core value (route + save tokens + never stop coding), and new work must not break the lightweight budget.

---

## 1. Purpose and Product Position

9Router is a **local AI gateway** that exposes a single OpenAI-compatible API (`/v1/*`, default port `20128`) for AI coding tools (Claude Code, Codex, Cursor, Cline, OpenClaw, Copilot, Gemini CLI, OpenCode, Roo, Kilo Code, …) and routes traffic across **40+ upstream providers / 100+ models**.

Core value propositions:

1. **Save tokens** — RTK token saver compresses `tool_result`-style content before it reaches the model (20–40% input savings); optional Headroom `/v1/compress` proxy and Caveman/Ponytail prompt modes cut output tokens.
2. **Never stop coding** — 3-tier fallback (subscription → cheap → free) and multi-account round-robin absorb quota exhaustion and rate limits.
3. **Universal compatibility** — request/response translation (OpenAI ↔ Claude ↔ Gemini ↔ Kiro ↔ Cursor ↔ Vertex ↔ OpenAI Responses) means any client that speaks one format can reach any provider.
4. **Maximize subscriptions** — real-time quota tracking, reset countdowns, and automatic OAuth token refresh.
5. **Free forever (the software)** — MIT licensed; dashboard "costs" are simulated savings trackers, never billing.

### 1.1 Definitions

| Term | Meaning |
|---|---|
| Gateway | The Next.js server process implementing `/v1/*` and `/api/*` |
| Provider | An upstream model service (OAuth, API-key, or OpenAI/Anthropic-compatible node) |
| Connection | A stored credential + config entry for one provider account |
| Combo | A named ordered list of models with a fallback strategy |
| RTK | In-process Rust-inspired JS token-saver pipeline (pre-translate hooks) |
| open-sse | The provider-agnostic routing/translation engine used by the dashboard/gateway |
| CLI launcher | The separate `cli/` npm package (`9router`) that installs/starts the server and tray |

---

## 2. Functional Requirements

### 2.1 API Surface (client-facing)

All endpoints below are OpenAI-compatible and reachable on the configured port.

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/chat/completions` | POST | Chat completions (streaming & non-streaming) |
| `/v1/messages` | POST | Anthropic-style messages |
| `/v1/responses`, `/codex/*`, `/responses` | POST | OpenAI Responses (Codex) API |
| `/v1/models` | GET | Model + combo listing in OpenAI format |
| `/v1/messages/count_tokens` | POST | Token counting |
| `/v1beta/models[...]` | GET | Beta model catalog (GitHub Copilot-style) |
| `/v1/embeddings`, `/v1/images`, `/v1/audio/*` | POST | Multimodal support where the provider supports it |
| `/v1/*` | POST | Any other OpenAI-compatible route (rewritten to `/api/v1/*`) |

Authentication: optional `Authorization: Bearer <key>` (enforced by `REQUIRE_API_KEY`); dashboard-generated API keys are HMAC-signed with `API_KEY_SECRET`.

**Request lifecycle (normative):** client → Next rewrite (`next.config.mjs`) → `src/app/api/v1/*` → `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop) → `open-sse/handlers/chatCore.js` (format detection, translation, executor dispatch, retry/refresh, stream setup) → `open-sse/executors/*` → upstream → SSE back to client.

**Model identifier contract:** `prefix/model` where `prefix` is the provider alias (`cc/claude-opus-4-7`, `kr/claude-sonnet-4.5`, `glm/glm-5.1`, `oc/<auto>`, `vertex/gemini-3-flash-preview`, …). A bare combo name resolves to its model sequence. A `(level)` suffix on a copied model name encodes forced reasoning effort, stripped before upstream dispatch.

### 2.2 Providers

**OAuth providers (PKCE / device-flow):** Claude Code (`cc/`), Codex (`cx/`), GitHub Copilot (`gh/`), Cursor (`cu/`), Antigravity, Kiro (`kr/`), Kimchi, xAI/Grok, Qoder, CodeBuddy CN, Gemini CLI, Grok CLI/Build, Kimi OAuth, Xiaomi MiMo Token Plan, PXPipe, Feliche/Featherless, Vercel AI Gateway, Perplexity Agent API, ClinerPass, OpenCode-Go, Alicode/Caveman, Venice, Blackbox, and others as they ship.

**Free providers (no account):** Kiro AI, OpenCode Free (`oc/`), Vertex AI ($300 new-GCP credits). Discontinued free tiers (iFlow, Qwen Code, Gemini CLI free) are deliberately de-prioritized and may be hidden.

**API-key providers (40+):** OpenAI, Anthropic, OpenRouter, Gemini, DeepSeek, Groq, Mistral, Perplexity, Together, Fireworks, Cerebras, Cohere, NVIDIA, SiliconFlow, GLM, Kimi, MiniMax, Nebius, Chutes, Hyperbolic, Cloudflare AI, Volcengine Ark, Zhipu, and arbitrary OpenAI/Anthropic-compatible custom nodes.

**Provider contract:** each provider has a registry entry (`open-sse/providers/registry/<provider>.js`), an optional executor if not OpenAI-compatible (`open-sse/executors/`), a translator path if its wire format differs, and model entries in `open-sse/config/providerModels.js`.

### 2.3 Token Saving (the headline feature)

| Feature | Mechanism | Default |
|---|---|---|
| **RTK Token Saver** | In-place compression of `tool_result` content before translation. Filters: `git-diff`, `git-status`, `grep`, `find`, `ls`, `tree`, `dedup-log`, `smart-truncate`, `read-numbered`, `search-list`. Auto-detect via first 1 KB. **Fail-open** (any error → original text). Runs before format translation so it works across all formats. | ON |
| **Headroom** | Optional external `/v1/compress` proxy invoked before provider routing; fails open when down. Configured via `HEADROOM_URL` / dashboard Endpoint → Token Saver → Headroom. | OFF |
| **Caveman Mode** | Injects a terse, caveman-speak system prompt to cut output tokens (~65%). | OFF |
| **Ponytail** | Injects a "lazy senior dev" YAGNI prompt (Lite / Full / Ultra) to reduce generated code. Stacks with Caveman + RTK. | OFF |
| **Bypass** | `X-9Router-Token-Saver: off` disables all token savers per request. | — |

### 2.4 Combo Strategies

A combo is a named ordered model sequence with a selectable strategy:

- **fallback** — try models in order; move to the next on quota/auth/error.
- **round-robin** — distribute requests across models.
- **fusion** — fan the prompt out to all members in parallel; a configurable judge model synthesizes one answer (quorum-grace, anonymized sources, graceful degradation).
- **capacity** — reorder models per request so images/PDFs route to capable models first.

Auto-switch behaviors: quota reset tracking, account cooldown, multi-account round-robin per provider, and per-model fallback eligibility driven by `open-sse/services/accountFallback.js`.

### 2.5 Quota, Usage, and Refresh

- Per-provider/per-model token usage, reset countdown kinds (5 h, daily, weekly, monthly, rolling), cost estimation (display/savings tracker only — 9Router never bills).
- OAuth tokens refresh automatically (in-flight dedup to prevent `refresh_token_reused`).
- Usage persisted to `~/.9router/usage.json` + `log.txt` (does NOT follow `DATA_DIR`; see Known Notes).
- Request/translator debug logs under `logs/` when `ENABLE_REQUEST_LOGS=true`.

### 2.6 Dashboard (management plane)

Privileged UI at `/dashboard` (default). Provides:

- Provider connection CRUD, OAuth/device-code flows, connection testing, bulk add/delete of API keys.
- Combo builder with per-combo strategy + fusion judge picker.
- Token-saver dashboard page.
- Quota tracker, usage analytics/trends, request logs.
- Model/alias/pricing management; custom compatible provider nodes.
- Endpoint page: API key reveal, `REQUIRE_API_KEY`, token-saver toggles.
- CLI tool configurators (OpenClaw, Cline, Copilot, Codex, OpenCode, Kilo Code, Cowork, Claude Code, etc.).
- Cloud sync enable/sync/disable.
- Tray controls (system tray via CLI launcher; kill via SIGTERM/SIGKILL escalation).

Auth: session cookie (JWT signed with `JWT_SECRET`), first-login password from `INITIAL_PASSWORD` (default `123456`, override mandatory), and derived machine-ID-based tokens for internal self-calls.

### 2.7 Cloud Sync (optional)

- Syncs providers, combos, aliases, API keys across devices to `CLOUD_URL` (default `https://9router.com`).
- Server-side vars `BASE_URL`/`CLOUD_URL` take precedence; `NEXT_PUBLIC_BASE_URL`/`NEXT_PUBLIC_CLOUD_URL` remain for compatibility/UI.
- Timeout + fail-fast so cloud DNS/network unavailability never hangs the UI; local runtime continues when sync fails.

### 2.8 Extended Transport (side features)

- **MITM proxy** (`src/mitm/`): runs an independent `server.js` child process; generates a root CA on startup; supports Antigravity 2.x, GitHub Copilot routing, stale-lock recovery.
- **Tunnels**: Cloudflare (`cloudflared`) and Tailscale manager modules for remote access; non-blocking probes.
- **Proxy pools**: Cloudflare Workers deployer + Deno Deploy relays for pool routing; auto-rotate strategy for no-auth providers.

---

## 3. Non-Functional Requirements

### 3.1 Performance & Lightweightness (CONSTRAINT)

- Single-node; runs on small machines (Raspberry-Pi-class acceptable).
- Runtime memory: no persistent background workers when disabled; inactive background services are skipped on startup.
- Streaming overhead: disconnect-aware stream controller; stall timeout 30 s; terminal-event emission so clients never hang.
- Startup/build: dev startup and bundle intentionally kept small; heavy barrel imports tree-shaken (`optimizePackageImports`); watch configured to exclude non-source dirs.
- No heavyweight ML, analytics services, or external event buses. All optional features (MITM, cloud sync, tunnels, Headroom) are **opt-in** and dormant when not configured.

### 3.2 Security

- Security-sensitive env: `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, `MACHINE_ID_SALT`.
- `custom-server.js` derives client IP from the TCP socket (unspoofable) and strips attacker-controlled `X-Forwarded-For`/`X-Real-IP` unless the peer is a loopback reverse proxy; rate-limit keys use the real peer address. Do not regress this.
- SSRF hardening on web fetch (web-search provider); reverse-proxy local-access trust hardened.
- `REQUIRE_API_KEY=true` recommended for internet-exposed deployments; `AUTH_COOKIE_SECURE=true` behind HTTPS.
- Provider secrets live in the local SQLite DB only; protect the data directory at the filesystem level.
- OAuth uses PKCE; device-code flows supported.
- Never hardcode credentials into source or docs.

### 3.3 Reliability

- Account cooldown + fallback before failing a request; combo moves to next model.
- 401/403 → refresh → retry in the core path; refresh lifecycle is durable and deduped.
- Stream pipe errors on client disconnect/abort handled; non-SSE stream pipes crash-guarded.
- SQLite schema migrations with automatic backup before schema change; corrupt `usage.json`/`log.txt` reset safeguards.
- Requests exceeding client body limit prevented at proxy layer (`NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE`, default `128mb`).

### 3.4 Compatibility

- Clients: any tool that accepts a custom OpenAI-compatible base URL + API key.
- Runtime: Node.js 20+ (Node ≥ 22.5 unlocks `node:sqlite`), or Bun (full parity via `bun:sqlite`).
- Package `9router-app` is private; distribution is via the `9router` CLI package, Docker, or source.
- i18n: 30+ languages in the dashboard (built-in `i18n/`), 6 translated READMEs.

---

## 4. Configuration Reference

### 4.1 Environment Variables

| Variable | Default | Required | Purpose |
|---|---|---|---|
| `JWT_SECRET` | auto-gen (`~/.9router/jwt-secret`) | for multi-instance | JWT signing secret for dashboard auth |
| `INITIAL_PASSWORD` | `123456` | override in prod | First-login password |
| `DATA_DIR` | `~/.9router` | — | Main data location (`$DATA_DIR/db/data.sqlite`) |
| `PORT` | `20128` | — | HTTP port |
| `HOSTNAME` | framework default | Docker sets `0.0.0.0` | Bind host |
| `NODE_ENV` | runtime default | `production` for deploy | Runtime mode |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | change in prod | HMAC for generated API keys |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | — | Machine-ID hashing salt |
| `ENABLE_REQUEST_LOGS` | `false` | — | Deep request/response logs under `logs/` |
| `OBSERVABILITY_ENABLED` | `true` | — | Usage observability aggregation |
| `AUTH_COOKIE_SECURE` | `false` | `true` behind HTTPS | Force Secure auth cookie |
| `REQUIRE_API_KEY` | `false` | `true` internet-exposed | Enforce Bearer key on `/v1/*` |
| `BASE_URL` | `http://localhost:20128` | cloud sync | Server-side internal callback URL |
| `CLOUD_URL` | `https://9router.com` | cloud sync | Cloud sync endpoint base |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | compat | Public/UI base URL |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | compat | Public cloud URL |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | empty | outbound proxy | Upstream call proxying (lowercase variants supported) |
| `SEARXNG_URL` | `http://localhost:8888/search` | web search | Built-in unauthenticated SearXNG provider endpoint |
| `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` | `128mb` | large payloads | Client body limit at proxy |
| `HEADROOM_URL` | `http://localhost:8787` | Headroom | Headroom compress proxy override (Docker sidecar examples: `http://headroom:8787`, `http://host.docker.internal:8787`) |
| `INSTANCE_NAME` | — | unused | Kept as reference; not read at runtime |

### 4.2 Runtime Storage

- Main state: `${DATA_DIR}/db/data.sqlite` (SQLite; providerConnections, providerNodes, modelAliases, combos, apiKeys, settings, pricing).
- Auto backups: `${DATA_DIR}/db/backups/`.
- Usage stats + log: `~/.9router/usage.json`, `~/.9router/log.txt` (independent of `DATA_DIR`).
- Optional debug logs: `<repo>/logs/...` with `ENABLE_REQUEST_LOGS=true`.
- DB driver chain: `bun:sqlite` → `better-sqlite3` (optional dep — installs never fail without build tools) → `node:sqlite` (Node ≥ 22.5) → `sql.js` (pure-JS, always works).

### 4.3 Deployment Modes

| Mode | Command | Notes |
|---|---|---|
| Local dev | `npm run dev` (next dev, port 20127 by default via script) | webpack dev |
| Production | `npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start` | standalone output |
| Bun | `npm run dev:bun` / `build:bun` / `start:bun` | `bun:sqlite` fast path |
| CLI | `npm install -g 9router; 9router` | installs/starts server + tray |
| Docker | `docker run -d -p 20128:20128 -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data decolua/9router:latest` | multi-arch amd64+arm64 |
| CapRover | `captain-definition` → `./Dockerfile` | supported |

---

## 5. Technical Requirements

### 5.1 Stack

- Runtime: Node.js 20+ (Bun optional)
- Framework: Next.js 16 (standalone output, rewrites for `/v1/*`)
- UI: React 19 + Tailwind CSS 4
- Data: SQLite (driver fallback chain)
- Streaming: SSE; binary/protobuf upstreams (Kiro EventStream, Cursor protobuf, CommandCode NDJSON) handled in dedicated executors
- Auth: OAuth 2.0 (PKCE) + JWT + API keys
- Code: Plain JavaScript (ESM), `@/*` alias → `src/*`; no TypeScript
- Lint: ESLint 9 (`eslint.config.mjs`, extends `eslint-config-next`)

### 5.2 Package Layout (normative)

- `src/app/api/*` — Next.js routes (dashboard + compat APIs)
- `src/sse/*` — app-side SSE glue (`handlers/chat.js` is the entry)
- `open-sse/*` — provider-agnostic routing/translation engine: `handlers/chatCore.js`, `executors/*`, `translator/*` (registers via side effect; new translators MUST be imported in `open-sse/translator/index.js`), `providers/registry/*` (auto-generated index — regenerate, don't hand-edit), `rtk/*` (fail-open token savers), `config/`, `services/`, `utils/`
- `cli/` — separate npm package (`9router`): launcher, tray, own version/build
- `src/lib/db/` — SQLite layer (driver.js, paths.js, repos/*, migrations/*)
- `src/lib/usageDb.js` — usage + log persistence
- `src/mitm/` — MITM proxy child process
- `tests/` — independent vitest ESM package (not wired into root `npm test`)

### 5.3 Testing Contract

- Run from `tests/`: `npm install` (root deps first) then `cd tests && npm install`, then `npx vitest run`.
- **Not all-green on plain checkout by design**: ~938 pass / ~64 fail are the committed baseline. Judge regressions with `tests/__baseline__/verify-no-regression.mjs`; 26 items catalogued in `tests/__baseline__/known-fails.txt`.
- `real/*.real.test.js` make live provider calls — skip without credentials.
- `cloud/`-referencing tests (e.g. `embeddings.cloud.test.js`) fail here because the `cloud/` worker dir is not in this repo.
- Touch provider registry/alias logic → run `tests/__baseline__/verify-*.mjs` snapshots.

---

## 6. Edge Cases and Rules

| Case | Rule |
|---|---|
| RTK filter throws / inflates | Fail open — keep original text |
| Headroom down | Fail open — send original request |
| Upstream drops mid-stream (Codex/Responses) | Auto-retry; emit terminal `response.failed` + `[DONE]` |
| Client disconnects | Pipe abort handled; no leak |
| OAuth refresh races | In-flight dedup; never `refresh_token_reused` |
| 401/403 on live traffic | Refresh then retry once |
| Combo member exhausted | Cooldown + next model in sequence |
| Provider model rejects `(level)` suffix | Stripped from `body.model` before upstream |
| Reasoning fields on unsupported provider | Stripped at executor/translator layer |
| Usage metadata missing | Usage estimation fallback |
| `usage.json` corrupted | Reset safeguard |
| DB schema drift | Migration + automatic pre-change backup |
| Non-JSON SSE line / duplicate `[DONE]` | Tolerated; never breaks the client |
| Streaming JSON client | Forced streaming preserved |
| Bare-email OAuth dedup | Not deduped (Codex) |
| Windows backslash find output | Detected + grouped by RTK |

## 7. Out of Scope

- Cloud service implementation behind `CLOUD_URL` (external).
- Provider SLAs/control planes outside the local process.
- External CLI binaries themselves.
- Billing/charging users (dashboard costs are simulated).
- Heavyweight cluster/HA modes (single-node by constraint).
- Inference hosting.

## 8. Compatibility and Versioning Notes

- Root package (`9router-app`) and `cli/` are versioned independently; changes logged in `CHANGELOG.md`.
- Conventional Commits style.
- Hidden/deprecated providers remain in registry but are not surfaced in the UI.
- Free-tier provider status changes (e.g. iFlow going paid, Qwen EOL) are reflected by re-categorizing providers, not by removing features.
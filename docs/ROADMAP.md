# 9Router Roadmap

_Last updated: 2026-08-16_

> **Standing constraint:** 9Router must stay **lightweight** — single-node, small memory, no heavyweight runtime machinery, minimal dependencies, opt-in features only. Every planned item below is sized and scoped against that constraint; any item that would violate it is marked and requires explicit re-scoping before work starts.

## How to read this roadmap

- **Phase 0 / 1** = near-term hardening & polish. **Phase 2** = feature enablement. **Phase 3** = experience & ecosystem.
- Each part is a shippable increment (implementation + tests + docs in the same change).
- Status legend: 🟢 in progress · 🟡 planned · 🔵 investigating · ⚪ backlog · ✅ shipped · ⊘ skipped.
- After a part ships, update both this file and `session.md`.

---

## Phase 0 — Baseline (already shipping)

| Part | Title | Status |
|---|---|---|
| 0.1 | Core gateway: `/v1` OpenAI-compatible surface, chat/responses/models | ✅ |
| 0.2 | 40+ providers, 100+ models, registry + executors + translators | ✅ |
| 0.3 | RTK token saver (fail-open, pre-translate) | ✅ |
| 0.4 | Combo strategies: fallback / round-robin / fusion / capacity | ✅ |
| 0.5 | Quota tracking, OAuth refresh, usage analytics, cloud sync | ✅ |
| 0.6 | Dashboard, tray CLI, Docker/CLI distribution | ✅ |
| 0.7 | Docs: README (+5 i18n), CLAUDE.md, DOCKER.md, ARCHITECTURE.md, this roadmap | ✅ |

---

## Phase 1 — Near-Term Hardening & Lightweight Polish

### 1.1 Baseline test health 🟡

**Problem:** The committed vitest baseline is ~938 pass / ~64 fail by design (26 catalogued in `known-fails.txt`; `cloud/` tests can't run here; 2 timeouts/xAI). Raw runs can't be used to judge regressions.

**Plan:**
1. Keep `verify-no-regression.mjs` as the canonical gate; document it in `docs/` so new contributors don't get scared by red.
2. Opportunistically fix catalogued fails that are cheap and deterministic (no new dependencies).
3. Add a lightweight smoke suite (5–10 tests) exercising the public `/v1` surface with a stubbed provider, so CI gets a fast positive signal.

**Done means:** documented baseline procedure in `docs/TESTING.md`; smoke suite green on clean checkout; no new dev dependencies beyond what already exists (vitest).

### 1.2 Unified request-log viewing 🔵

**Problem:** `ENABLE_REQUEST_LOGS=true` writes deep `logs/` files but viewing them is manual.

**Plan:**
1. Investigate the cheapest read path (a small dashboard Logs tab that tails the last N KB per file — no new service, no polling daemon).
2. Add basic filtering (provider/model/status) if zero-cost.
3. Respect `OBSERVABILITY_ENABLED` gating.

**Done means:** logs viewable from dashboard without external tools; feature off and zero-cost when `ENABLE_REQUEST_LOGS=false`.

---

## Phase 2 — Feature Enablement (lightweight-scoped)

### 2.1 Deeper token-saving: RTK filter expansion 🟡

**Plan:**
1. Audit which popular tool outputs still lack a filter (e.g. `terraform plan`, `kubectl get -o yaml`, `npm ls`, JSON log blobs).
2. Add 2–4 new lossless filters following the fail-open RTK pattern.
3. Publish per-filter savings stats in the Token Saver dashboard page.

**Done means:** new filters shipped with tests; zero regression on existing filters (baseline snapshots updated intentionally).

### 2.2 Lightweight "combo budget guard" 🔵

**Problem:** Some users want a hard per-combo cost/month cap without per-provider config.

**Plan:**
1. Design a per-combo `budgetUsdPerMonth` field (opt-in, advisory).
2. Track spend from existing usage stats (already persisted) — no new machinery.
3. When exceeded, combo routes past the expensive members to cheaper/free ones (existing fallback path).

**Done means:** config field + dashboard toggle + tests; no new services/deps.

### 2.3 Provider registry hygiene automation 🔵

**Problem:** Registry index + display map are auto-generated but regeneration is manual scripts.

**Plan:**
1. Wrap `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs` into one `npm run registry:sync`.
2. Add a CI check that registry/display files are in sync (fail loudly on drift).
3. Document the workflow in `open-sse/AGENTS.md`.

**Done means:** one command syncs; CI catches drift; no runtime change.

### 2.4 Migration tooling for the SQLite layer 🟡

**Problem:** DB layer went from `db.json` to SQLite with a migration path, but user-facing import/export from older/db.json installs is not fully documented.

**Plan:**
1. Document the supported upgrade paths in README/DOCKER (including legacy `~/.9router/db.json`).
2. Add a one-shot `npm run db:migrate-legacy` help that converts old JSON state to SQLite where possible (opt-in, read-only on source).

**Done means:** documented, backed by tests; no behavior change for fresh installs.

### 2.5 Free-tier health radar 🔵

**Problem:** Free providers (Kiro, OpenCode Free, Vertex) occasionally change terms; users can't tell before a request fails.

**Plan:**
1. Add a lightweight "provider health" probe page in the dashboard (cheap, on-demand only — no background polling).
2. Show last-known status + stale timestamp for free/cheap providers.

**Done means:** manual refresh; no background jobs; no new deps.

---

## Phase 3 — Experience & Ecosystem (lightweight-constrained)

### 3.1 Improved CLI launcher onboarding 🟡

**Plan:**
1. Guided first-run (detect platform, ask for data dir, open dashboard, print quick-start config snippets for the 3 most common tools).
2. `9router status` command (checks port/health/MITM/tunnel state).
3. Keep it a single-file addition in `cli/`; no new runtime deps.

**Done means:** first-run flow + status command tested; `cli/` bundle stays slim.

### 3.2 Stable machine-id / key migration assistant 🔵

**Problem:** `API_KEY_SECRET`/`MACHINE_ID_SALT` defaults are shared examples; changing them later changes generated keys/ids.

**Plan:**
1. Document the semantics + migration (regenerate keys, no data loss).
2. Add a dashboard hint when defaults are detected in production.

**Done means:** documentation + warning; no code path complexity added.

### 3.3 Community docs & recipe library ⚪

**Plan:**
1. Grow `docs/` with provider-specific recipes, combo templates, and troubleshooting-from-the-field.
2. Link from README; keep `session.md`/docs synchronized.

**Done means:** a curated recipe set; no code impact.

### 3.4 Explore embedding the `open-sse` engine as a standalone library ⚪

**Plan:**
1. Investigate publishing `open-sse` (the provider-agnostic engine) as its own npm package with a stable API.
2. Would let other tools reuse routing/translation without the dashboard.

**Done means:** investigation note with exit criteria; publish only if it adds no maintenance burden.

---

## Explicitly Out of Scope (lightweight constraint)

- Cluster/HA modes, multi-node storage backends.
- Heavy analytics/ML pipelines, model fine-tuning, inference hosting.
- Managed cloud control plane (the local process is the product).
- Any background daemon that runs when not explicitly enabled.
- Introducing new non-optional dependencies.

## Recommendations (new, from the 2026-08-16 documentation pass)

1. **Adopt `session.md`** in this repo as the project-continuity log (create it); currently absent.
2. **Add `docs/TESTING.md`** referencing the real baseline procedure (see 1.1) so the ~64 committed failures stop being mistaken for regressions.
3. **Refresh ARCHITECTURE.md periodically** — `CLAUDE.md` notes it's already stale in the persistence section; treat docs as equal citizens of each PR.
4. **Keep the `open-sse` ↔ `src/sse` boundary explicit** in code review so the engine stays usable standalone.

## How to Influence This Roadmap

Open an issue or PR against this repo. The maintainers prioritize items by: (1) does it serve "route + save tokens + never stop coding"? (2) does it stay lightweight? (3) is it well-scoped and testable?
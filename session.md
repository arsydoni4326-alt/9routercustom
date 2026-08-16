# session.md — 9Router

## Current Objective

Comprehensive documentation pass over the 9Router project: README, architecture, specification, roadmap. Constraint: keep the project lightweight (single-node, low memory, no heavyweight runtime machinery, opt-in features only).

## Completed Work (2026-08-16)

- Reviewed repo surface: `package.json` (0.5.35), `next.config.mjs`, `custom-server.js`, `Dockerfile(s)`, `docker-compose.yml`, `README.md` (+ zh-CN), `CHANGELOG.md`, `CLAUDE.md`, `DOCKER.md`, env files.
- Confirmed with user the documentation set to deliver: README (extend existing), ARCHITECTURE.md (refresh), SPECIFICATION.md (new), ROADMAP.md (new).
- Verified `9router/docs/ARCHITECTURE.md` already exists (committed) and covers request lifecycle, combo/account fallback, OAuth+refresh, cloud sync, data model, env matrix. It was NOT modified in this pass; it remains the authoritative architecture document.
- Created `9router/docs/SPECIFICATION.md` — functional + non-functional requirements, config reference, testing contract, edge cases, out-of-scope.
- Created `9router/docs/ROADMAP.md` — Phase 0 baseline (shipped), Phase 1 hardening, Phase 2 feature enablement, Phase 3 experience/ecosystem; all scoped against the lightweight constraint; includes new recommendations.
- README.md left in place (it already covers quick start, features, providers, models, setup, troubleshooting). No blocking discrepancies found that required editing it.

## Implementation Decisions

- Docs are the deliverable; no application code was changed.
- Documented the real SQLite state model (driver fallback chain: `bun:sqlite` → `better-sqlite3` → `node:sqlite` → `sql.js`) in the new docs; noted `CLAUDE.md` already flags `docs/ARCHITECTURE.md` as stale in the persistence section.
- Documented the committed vitest baseline (~938 pass / ~64 fail; judge via `tests/__baseline__/verify-no-regression.mjs`, 26 items in `known-fails.txt`) in SPECIFICATION.md.
- Roadmap recommendations adopted: create `session.md` (this file), add `docs/TESTING.md` (baseline procedure), periodically refresh ARCHITECTURE.md, keep `open-sse` ↔ `src/sse` boundary explicit.

## Assumptions

- "Comprehensive documentation" = README (existing is sufficient) + architecture + specification + roadmap in `docs/`.
- Lightweight constraint applies to every planned future item in ROADMAP.md.

## Known Limitations

- `tests/` suite is not all-green on a plain checkout by design — see ROADMAP 1.1 / SPECIFICATION §5.3.
- `cloud/` worker dir referenced by some tests is not in this repo.

## Pending Work

- [ ] Optional: add `docs/TESTING.md` (baseline procedure + smoke suite) per ROADMAP 1.1.
- [ ] Optional: refresh ARCHITECTURE.md persistence section to match the SQLite layer.
- [ ] Optional: link the new docs from README footer.

## Relevant Test Results

- No tests run — documentation-only change.
# Unified Request-Log Viewing

> Phase 1.2 — documentation and plan for the unified request-log view.
> Constraint: keep the system lightweight (single node, low memory, no new
> always-on services). This document is the single source for how request
> logs work today and what minimal improvements are planned.

## 1. The unified model

Request logging is **unified around one source of truth**: the SQLite
`usageHistory` table (main DB at `${DATA_DIR}/db/data.sqlite`).

- Every proxied request already inserts a row into `usageHistory`
  (timestamp, provider, model, connectionId, token usage, status).
- The request-log **list view is derived from that table at read time** —
  there is no separate log file for the list.
- `appendRequestLog()` in `src/lib/db/repos/usageRepo.js` is deliberately a
  **no-op** (kept for backward compatibility). Call sites may still import it;
  nothing is written through it anymore.
- Optional per-request **payload details** are stored separately in
  `request-details.json` under `DATA_DIR` (see §4) — the only opt-in,
  heavier-weight layer.

### Data flow

```
Client request
   │
   ▼
src/sse/* + open-sse/* handling
   │  records tokens/status into usageHistory (SQLite)
   ▼
GET /api/usage/request-logs  ──┐
GET /api/usage/logs           ├── getRecentLogs(200)  → unified list view
                              │    (usageRepo → usageHistory)
GET /api/usage/request-details ┘
   │  → requestDetailsRepo (requestDetailsRepo.js, request-details.json)
   ▼
Dashboard: RequestLogger / RequestDetailsTab
```

## 2. Endpoints

| Endpoint | Purpose | Response |
| --- | --- | --- |
| `GET /api/usage/request-logs` | Recent unified log lines for the dashboard logger widget | JSON array of formatted strings (`getRecentLogs(200)`) |
| `GET /api/usage/logs` | Same unified view; identical handler (alias) | JSON array of formatted strings (`getRecentLogs(200)`) |
| `GET /api/usage/request-details` | Structured, paginated request details | JSON with pagination + filters |

Unified log line format (from `getRecentLogs`):

```
{timestamp} | {model} | {provider} | {account} | {sent} | {received} | {status}
```

- `timestamp` — formatted `DD-MM-YYYY HH:MM:SS`.
- `provider` — uppercased provider id, `-` when unknown.
- `account` — resolved connection name/email, else first 8 chars of the
  connection id, else `-`.
- `sent` / `received` — prompt tokens / completion tokens (from the row, or
  the parsed `tokens` JSON blob), `-` when absent.
- `status` — the request status, `-` when absent.

Rows are returned newest-first (`ORDER BY id DESC`).

### Request details API

`GET /api/usage/request-details` accepts:

| Query param | Meaning |
| --- | --- |
| `page`, `pageSize` | Pagination (`pageSize` 1–100) |
| `provider`, `model`, `connectionId`, `status` | Filters |
| `startDate`, `endDate` | Time-range filter |

**Security**: payloads are redacted before being served (see §5). The
`request-details` layer is gated and should stay opt-in.

## 3. Enablement / gating

- Observability (request logging) is **opt-in**, off by default.
- `ENABLE_REQUEST_LOGS=true` enables request-log capture and **overrides the
  UI setting** (env var wins).
- The dashboard setting `requestLogsEnabled` is the UI-controlled equivalent.
- Historical note (v0.5.50 fix): the env var previously failed to override
  the UI setting; today the env var takes precedence.

Recommended production posture:

```bash
# On a single-node deployment, logs add negligible load.
# Leave off unless you are debugging routing/translation issues.
ENABLE_REQUEST_LOGS=false
```

## 4. Storage

| Data | Location | Notes |
| --- | --- | --- |
| Usage/history rows | `${DATA_DIR}/db/data.sqlite` → `usageHistory` | Unified source for list views and analytics; day-rollup tables back 7/30/60-day charts |
| Request/details payloads | `${DATA_DIR}/request-details.json` | Opt-in detail layer (`ENABLE_REQUEST_LOGS`), redacted on read |
| Legacy usage files | `~/.9router` (`usage.json`, `log.txt`) | Legacy `src/lib/usageDb` surface retained for compatibility; new code goes through `src/lib/db/repos/*` |

`src/lib/usageDb.js` is a thin re-export shim over the repo layer — new code
should import the repos directly (`@/lib/db` / `lib/db/index.js`).

## 5. Security

- `/api/usage/request-details` redacts request/response payloads before
  serving them (v0.5.55 hardening).
- Do not disable redaction; details can contain conversation content, tool
  output, and possibly credentials if a provider echoes them.
- The detail layer is gated and off by default — keep it that way on shared /
  internet-exposed deployments.

## 6. User-facing documentation

- README table row "📝 **Request Logging**" (Debug mode with full
  request/response logs) — update wording to: *unified request log derived
  from usage history; structured redacted details when `ENABLE_REQUEST_LOGS`
  is enabled*.
- Troubleshooting entry "No request logs under `logs/`":
  `ENABLE_REQUEST_LOGS=true` — clarify that the **list view** comes from
  `usageHistory` and always works; details need the env flag.

## 7. Phase 1.2 plan (lightweight)

Objective: document and lightly consolidate the unified view without adding
services, memory, or new always-on work.

| # | Item | Type | Rationale |
| --- | --- | --- | --- |
| 1 | Author this document (`docs/REQUEST-LOGS.md`) as the single source for the unified request-log model | Doc | Done in this phase |
| 2 | Update README feature + troubleshooting wording (§6) | Doc | Keep user docs synchronized |
| 3 | Collapse the duplicated `/api/usage/logs` ↔ `/api/usage/request-logs` handlers into one implementation, keeping both routes as aliases | Code (tiny) | Deferred to Phase 1.2 execution if tests allow; both are identical today |
| 4 | Add retention note for `request-details.json` (rotate/cleanup) | Doc/ops | Prevent unbounded growth on long-running single nodes |
| 5 | Update `session.md` with Phase 1.2 decisions | Doc | Session continuity |

Non-goals (explicitly out of scope to stay lightweight):

- No new log daemon, queue, or external log backend.
- No per-provider log sharding or multi-node log aggregation.
- No schema migration: `usageHistory` already serves the unified view.

## 8. Troubleshooting

| Symptom | Cause / action |
| --- | --- |
| List view empty | Call any `/v1/*` route once, then re-open the Usage → Details tab; verify `usageHistory` has rows in `db/data.sqlite` |
| Details tab empty | `ENABLE_REQUEST_LOGS=false` (default). Set `ENABLE_REQUEST_LOGS=true` and restart |
| Env var ignored | Confirm the env var name and that the process was restarted; env overrides UI |
| Duplicate-looking routes | `/api/usage/logs` and `/api/usage/request-logs` are intentional aliases (§2); consolidation tracked in §7 item 3 |

## 9. Definition of done (Phase 1.2)

- [x] `docs/REQUEST-LOGS.md` created and accurate against the current code.
- [ ] README wording updated (§6).
- [ ] `/api/usage/logs` ↔ `/api/usage/request-logs` alias consolidation merged
      (only if the vitest gate stays green — otherwise documented as deferred).
- [ ] Retention guidance for `request-details.json` documented (§7 item 4).
- [ ] `session.md` reflects Phase 1.2 completion.
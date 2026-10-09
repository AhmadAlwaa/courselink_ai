# Prompts to paste into Claude Code

Run them in order. Don't move on until the milestone's "done when" in PROJECT_SPEC.md is true.

---

## Prompt 0 — Orientation (no code)

```
Read CLAUDE.md, backend/app/ai/CLAUDE.md, docs/PROJECT_SPEC.md and docs/API_CONTRACT.md.
Don't write code yet. Reply with:
1. A Mermaid diagram of the system as you understand it.
2. Which folders you own (BUILD) and which I own (TEACH), in one line each.
3. The riskiest unknown in M0 and how you'll test it.
4. Anything in the docs that is contradictory or underspecified (max 5 items).
```

## Prompt 1 — M0: CourseLink API spike

```
Start M0 from docs/PROJECT_SPEC.md.
Build the smallest MV3 extension (TypeScript + Vite) that, on a courselink.uoguelph.ca tab:
- calls GET /d2l/api/versions/ and picks the LP and LE versions,
- calls each candidate endpoint in the spec for my enrolled courses,
- tries the same calls from (a) a content script and (b) the background service worker with credentials: "include",
- logs status, context, and a trimmed response for each.
All requests must go through a GET-only client that throws on other methods.
Tell me exactly how to load it unpacked and what to look for in the console.
After I paste results, save redacted fixtures to extension/fixtures/ and write findings to docs/PROGRESS.md.
```

## Prompt 2 — M1a: extension sync

```
Using the M0 findings, build the extension sync layer:
- Zod schemas for each CourseLink response we use (from the fixtures),
- mappers to the contract types in docs/API_CONTRACT.md (extension/src/api/types.ts),
- sync triggers: chrome.alarms every 30 min and on CourseLink tab open, with a lock so syncs don't overlap,
- session-expired detection (401/403/login redirect) -> badge + stored status,
- unit tests for the mappers using the fixtures (Vitest).
POST to the backend can be a stub that logs the payload for now. Small steps; stop after each so I can verify.
```

## Prompt 3 — M1b: backend plumbing

```
Build the backend plumbing for M1 (BUILD mode):
- docker-compose.yml with postgres and backend (neo4j comes later),
- FastAPI app with config, X-GryphCal-Key auth, /health,
- SQLAlchemy models + Alembic migration for courses, deadlines, announcements, content_items, files, syncs, changes, notifications, time_logs,
- POST /sync that upserts the snapshot and runs deterministic change detection producing Change rows,
- files_needed + POST /files with sha256 dedup, POST /session-status,
- pytest tests for change detection using the extension fixtures (moved due date, edited announcement, new file, removed deadline).
Create backend/app/ai/interfaces.py with signatures for estimate_deadline, summarize_change, classify_affected_deadlines — no implementations.
Then wire the extension's stub POST to the real backend.
Explain the change-detection design briefly with a diagram before writing it.
```

## Prompt 4 — M2: UI + notifications

```
Build M2:
- Side panel React app: week calendar + list view of deadlines (status, grade, estimate if present, start-by), change feed, session-expired banner, options page for backend URL and key.
- Deterministic start-by calculator in the backend (estimate midpoint, or a default of 3 hours if no estimate, spread over available evenings before due_at, accounting for overlapping deadlines). Unit tests.
- Notifications: backend creates start_by and change notifications; extension polls /notifications and shows chrome.notifications.
Keep the UI simple and clean; no design rabbit holes.
```

## Prompt 5 — AI-facing UI against stubs

```
Build the UI and endpoints for AI features I'll implement myself, against the contract:
- "Estimate" button on a deadline -> POST /deadlines/{id}/estimate (shows "not implemented yet" on 501),
- time-log input on each deadline,
- chat panel using SSE from POST /chat with citation rendering,
- pending plan view with approve / reject-with-feedback,
- grade what-if form (backend endpoint is deterministic — build it fully with tests).
AI endpoints call functions in backend/app/ai/interfaces.py and return 501 if they raise NotImplementedError.
```

---

## Prompts for the AI work (TEACH mode, M3 onward)

```
/teach structured outputs with Pydantic and Claude
```

```
We're starting the workload estimator (learning milestone 1 in backend/app/ai/CLAUDE.md).
Follow TEACH mode. Give me the spec, the function signature, a test, and the part I should
write myself. Write the scaffolding only.
```

```
/review-mine backend/app/ai/estimator.py
```

```
Before we tune the estimator prompt, set up the eval: dataset format in backend/evals/,
a runner that computes MAE vs logged actual hours, and results saved per prompt version.
I'll write the metric function.
```

```
I got this error: <paste>. Cause first, then fix, then how I could have diagnosed it.
```

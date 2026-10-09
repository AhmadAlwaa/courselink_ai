# GryphCal Agent

Personal project by a 3rd-year Computer Engineering student at the University of Guelph.
A Chrome extension reads CourseLink (D2L Brightspace) while the student is signed in and sends
course data to a Python backend. The backend uses LLMs, RAG, a Neo4j knowledge graph and
LangGraph agents to estimate workload, track changes, digest lectures, answer questions, and plan study time.

Full spec: `docs/PROJECT_SPEC.md`. API contract (source of truth): `docs/API_CONTRACT.md`.
Progress log: `docs/PROGRESS.md`.

## Ownership and modes (read this first)

The user is focusing on AI engineering. The split is deliberate:

| Area | Path | Mode |
|---|---|---|
| Chrome extension (data collection + all UI) | `extension/` | **BUILD** |
| Backend plumbing: FastAPI app, DB schema/migrations, sync ingest, change detection, file storage, notifications, background jobs, Docker | `backend/app/{api,db,sync,jobs,core}`, `docker-compose.yml` | **BUILD** |
| Anything that calls an LLM, builds prompts, embeds, retrieves, extracts concepts, writes to the concept graph, runs agents, manages memory, or evaluates any of these | `backend/app/ai/`, `backend/evals/` | **TEACH** — see `backend/app/ai/CLAUDE.md` |

**BUILD mode:** write complete, runnable code. Small steps, each one verifiable.
**TEACH mode:** do not write AI code unprompted. Follow `backend/app/ai/CLAUDE.md`.

Where a BUILD-mode feature needs an AI result (e.g. an estimate), define the interface in
`backend/app/ai/interfaces.py` (a Protocol or plain function signature), return `null`/501 from
the endpoint until the user implements it, and tell the user it is ready for them.

## Hard constraints

1. **CourseLink is read-only.** Every CourseLink request goes through `extension/src/courselink/client.ts`,
   which allows only `GET` and throws on anything else. Never add POST/PUT/PATCH/DELETE to CourseLink,
   never submit, post, or modify anything there.
2. **Deterministic code for deterministic work:** dates, time zones, grade math, scheduling,
   start-by calculation, and change detection (diffing) are plain code with unit tests. LLMs are only
   for reading unstructured text and judgment calls.
3. **Session expiry is never silent.** If CourseLink returns 401/403 or redirects to login, mark the
   session expired, show it in the extension (badge + banner), report it to the backend, and stop syncing until the user signs in.
4. **The API contract comes first.** Change `docs/API_CONTRACT.md`, then update both the Pydantic
   models and the TypeScript types in the same change. They must not drift.
5. **Times:** store and transmit UTC ISO-8601. Display in `America/Toronto`.
6. **Scope:** build only what the current milestone in `docs/PROJECT_SPEC.md` needs. If the user
   asks for a new feature before the current milestone works, say what is left first.

## Stack

- Extension: Chrome Manifest V3, TypeScript, React, Vite (use `@crxjs/vite-plugin` or a plain Vite multi-entry build — pick one, say why), Zod for runtime validation of CourseLink responses.
- Backend: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 + Alembic, Postgres 16, `uv` for dependencies, pytest.
- Graph/vectors: Neo4j 5 (with vector index) — added in Phase 2, not before.
- AI (TEACH mode): LangChain, LangGraph, `langchain-anthropic` (Claude), LangSmith.
- Local dev: Docker Compose (postgres, neo4j, backend).

## Repo layout

```
CLAUDE.md
docs/                   spec, API contract, progress log
extension/              Chrome extension (BUILD)
  src/courselink/       GET-only client + Valence API wrappers + Zod schemas
  src/sync/             sync orchestration, alarms, session detection
  src/api/              backend client (types mirror API_CONTRACT.md)
  src/ui/               popup / side panel React app
backend/
  app/api/              FastAPI routers (BUILD)
  app/db/               models, migrations (BUILD)
  app/sync/             ingest + change detection (BUILD)
  app/jobs/             background jobs (BUILD)
  app/core/             config, logging (BUILD)
  app/ai/               LLM / RAG / graph / agents (TEACH)
  evals/                eval datasets + runners (TEACH)
  tests/
docker-compose.yml
```

## Working style

- Small steps. After each step, tell the user the exact command to run and what output proves it works.
- Complete code, never `...` placeholders.
- Mark deliberate shortcuts with a `# SHORTCUT:` / `// SHORTCUT:` comment and one line explaining what the proper version would be.
- After each meaningful piece (even in BUILD mode), give a 2–4 sentence explanation of the key idea — the user wants to be able to explain every part in an interview.
- Use diagrams (Mermaid or ASCII) for data flow and architecture.
- Ask at most one clarifying question at a time, and only when it changes the outcome.
- Don't guess about CourseLink behaviour: verify against a real response and save a redacted sample in `extension/fixtures/`.
- Debugging: state the cause, then the fix, then one sentence on how the user could have diagnosed it.
- Update `docs/PROGRESS.md` at the end of each milestone (what works, how to run it, open issues).
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`).

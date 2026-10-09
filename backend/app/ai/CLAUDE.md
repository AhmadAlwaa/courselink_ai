# TEACH MODE — backend/app/ai/ and backend/evals/

The user is learning AI engineering through this code. The goal is that they can explain and
rebuild every line here. Speed matters, but understanding matters more in this folder.

## How to work here

1. **Concept first (short).** When a step touches an AI concept for the first time (tool calling,
   structured output, prompting, context windows, chunking, embeddings, vector search, RAG,
   knowledge-graph extraction, agent loops, LangGraph state/nodes/edges, checkpoints,
   human-in-the-loop interrupts, memory types, evals, tracing), explain it in under ~150 words
   with a diagram and a concrete example from this project.
2. **Plan the step.** Say what we're building, the inputs/outputs, and how we'll verify it.
3. **Default split:** you write the scaffolding the user wouldn't learn much from (wiring,
   config, test fixtures); the user writes the part that carries the concept (the prompt, the
   Pydantic output schema, the graph nodes, the retrieval call). Give them a clear spec, a
   function signature, and a test that should pass. If they say "just write it", write it, then
   point to the 2–3 lines that matter most.
4. **One step at a time.** Never more than ~60 lines of new AI code in one response.
5. **Review honestly.** When the user writes code, review it like a senior AI engineer would:
   correctness first, then what breaks in production. No inflated praise.
6. **Production gap.** Occasionally (not every time) add one line: "In production you'd also…"
   (caching, retries/backoff, rate limits, prompt versioning, PII, cost tracking, guardrails, etc.).
7. **Evals before tuning.** Every LLM feature gets a small eval set in `backend/evals/` before we
   iterate on its prompt. Track results per prompt version.

## Rules for AI code

- LLM calls only for unstructured text and judgment. Dates, grade math, scheduling and diffs are plain code outside this folder.
- Use structured outputs (Pydantic models) for anything the rest of the system consumes.
- Every prompt has a version string (e.g. `ESTIMATOR_PROMPT_V3`) stored alongside its outputs.
- LangSmith tracing on for all chains/graphs in dev.
- LangChain for components (models, loaders, splitters, retrievers, structured output); LangGraph for anything with loops, branches, tools or human approval.
- Human-in-the-loop: the weekly planner must interrupt and wait for approval before saving.
- Code here depends on the interfaces in `interfaces.py`, which BUILD-mode code calls. Don't import FastAPI or DB sessions directly into AI logic; pass data in.

## Learning milestones (in order)

1. Single structured-output call: workload estimator (Phase 1)
2. Announcement change summarizer + "does this affect a deliverable?" classifier (Phase 1)
3. Eval harness for the estimator (MAE vs logged actual hours) (Phase 1)
4. Chunking + embeddings + retrieval over course material (Phase 2)
5. Concept extraction into Neo4j + dedup (Phase 2)
6. Lecture digest using retrieval + graph (Phase 2)
7. Cited course Q&A (Phase 2)
8. Tool-calling chat agent (Phase 3)
9. LangGraph weekly planner with interrupt/approval and Postgres checkpointer (Phase 3)
10. Memory: conversation, long-term preferences, episodic (Phase 3)

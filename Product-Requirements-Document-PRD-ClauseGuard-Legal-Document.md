# ClauseGuard — Product Requirements Document

**v2.0 — Round 2 build.** This revision incorporates everything the Round 1 evaluation flagged. The big additions: §6.1 (LLM observability, which was our #1 gap), §11.2 (API security controls, gap #2), §9.2 (the Qdrant production configuration we actually shipped instead of just describing), §16 (the prompt standard we rewrote all five agents to), and §17 (the human-feedback learning loop). We also moved inference to Groq-hosted open-weight models — the free tier fits a hackathon budget and the constrained decoding turned out to be a genuine win, not just a cost compromise.

## 1. Executive Summary

ClauseGuard reviews contracts: it splits a document into clauses, scores each one against market-standard language, and drafts safer replacement wording for the risky ones. The part we care most about — and the reason the architecture looks the way it does — is that the AI never finalizes anything on its own. The workflow physically suspends at two points and waits for a human. Every claim the system makes has to be grounded in retrieved source material, and a separate safety layer (Enkrypt AI) verifies that grounding before a human ever sees the output.

Stack, in one line: Mastra runs the agents and the durable workflow, Qdrant stores the benchmark library and the memory of past human decisions, Enkrypt AI gates every output.

## 2. Problem Statement

SMBs sign contracts without lawyers. A founder reviewing a vendor MSA doesn't know that a 180-day auto-renewal notice period is aggressive, or that "perpetual royalty-free license to all Customer data" is not something most vendors ask for. In-house counsel, where it exists, spends hours on reviews that are 80% routine.

The obvious answer — "paste it into a chatbot" — has two problems we take seriously:

1. LLMs make things up, and legal advice is one of the worst places for that. An invented precedent or a misread clause can be worse than no review at all.
2. Regulators have noticed. EU-AI-Act-style rules classify legal AI as high-risk, which in practice means human oversight at decision points and a real audit trail — not properties you can bolt on later.

So the product requirement isn't "AI that reviews contracts." It's "AI contract review that a compliance lead would let into the building."

## 3. Goals

- Cut routine review time from hours to minutes.
- Every risk finding must cite a retrieved benchmark from the clause library — no unsourced claims.
- Every user-facing output passes an Enkrypt gate (or a documented local fallback) before display.
- A complete audit trail: every AI verdict, every human decision, every token spent.

## 4. Target Users

In-house counsel who want the routine 80% accelerated; SMB founders and ops leads who need to know what "market standard" looks like without hiring for it; procurement reviewers hunting operational risk in vendor paper; and compliance leads who won't approve any of this unless the audit story holds up.

## 5. Functional Requirements

### 5.1 Document processing & analysis

Upload PDF, DOCX, or TXT. The parser splits the document into clauses — deterministic rules first (numbered headings, paragraphs, sentence windows), with an LLM pass that only refines boundaries. We ordered it that way on purpose: parsing can never fail outright, because it doesn't depend on a model call succeeding. The classifier then assigns each clause one of 20 legal types (indemnification, termination, auto-renewal, and so on — a fixed taxonomy, so enum drift is impossible). The UI renders a risk heatmap once scores land.

### 5.2 Benchmarking & redlining

Risk scores have to be justified against something real. Each clause is embedded and searched against `clause_library` — market-standard language in Qdrant — and the risk agent must quote the clause and cite the benchmarks it retrieved. For clauses that score risky, the redline agent drafts alternative language anchored to those same benchmarks, shown side-by-side (original vs. proposed) in the UI.

### 5.3 Workflow & human gates

The whole pipeline runs as one Mastra workflow (`legalReviewWorkflow`). It suspends twice:

- **Gate 1, after risk scoring.** A human reviews the findings and can override any risk level with a note before anything else is spent on drafting. This gate validates *facts*.
- **Gate 2, after redline generation.** Approve, edit, or reject each redline. This gate validates *output*.

Suspension is real, not a UI trick — the workflow state snapshots to the database, and the run survives process restarts (we killed the server mid-run twice to prove it).

There's also a Q&A chat over the document. Answers must cite clauses in `[clause:N]` format, citations are verified in code against real clause ordinals, and answers that fail grounding are blocked rather than shown.

## 6. Non-Functional Requirements

Progress streams to the UI over SSE, so long waits are at least transparent. Workflow snapshots and app data live in LibSQL for the MVP (Neon Postgres is a Drizzle config change away — see §12). Suspended runs must survive restarts. And the standing rule: no LLM output reaches the frontend without passing through a gate.

### 6.1 LLM Observability & Tracing

This was the biggest hole in Round 1, so the requirements here are deliberately strict:

- **100% trace coverage.** Every LLM call is recorded in `llm_traces`: agent ID, model version, input/output/total tokens, latency, status, and error message on failure.
- **Prompts are never stored.** We record a SHA-256 hash of the prompt instead — enough to detect prompt changes and dedupe, without persisting confidential contract text into a telemetry table.
- **Correlation IDs end to end.** The Next.js gateway mints a UUID per request; it's forwarded to the runtime and stamped on every trace, Enkrypt verdict, and workflow run. You can follow one browser click all the way down.
- **Span-level tracing** via `@mastra/observability` (storage exporter + sensitive-data filter), OpenTelemetry-compatible, inspectable in Mastra Studio during development.
- **A dashboard, not just a table.** The Observability view shows per-agent call counts, token totals, average latency, and error rates, with per-trace drill-down (`GET /api/observability/traces`).
- Trace writes are fire-and-forget: a telemetry failure must never fail a user request. Target p95 per-call latency under 20s on the Groq free tier.

## 7. System Architecture Overview

Five layers, kept deliberately separable:

1. **Frontend + gateway** — Next.js 16. The browser never talks to the agent runtime; the gateway handles rate limiting, input validation, and correlation-ID minting, then proxies with a service credential.
2. **Orchestration** — the Mastra runtime: the durable workflow plus five agents, exposed through hardened custom routes.
3. **Intelligence** — Groq-hosted `gpt-oss-120b` (reasoning) and `gpt-oss-20b` (fast tasks) through Mastra's model router; Qdrant for hybrid RAG and long-term memory. Embeddings are computed locally (BGE-small dense + SPLADE sparse via fastembed) — zero marginal cost and no third-party embedding API ever sees contract text.
4. **Safety** — Enkrypt AI as a four-gate firewall (G1–G4, §11.1), every verdict persisted.
5. **Persistence** — LibSQL/SQLite for metadata and audit logs; local disk behind an S3-compatible interface for raw documents.

### 7.1 Service decomposition & scale-out roadmap

The MVP is already two independently deployable services (web gateway, agent runtime) talking over authenticated HTTP. More importantly, the runtime is stateless between workflow steps — all state lives in storage, checkpointed after every step. That's exactly the property a queue architecture needs: the heavy agents (`docParserAgent`, `redlineAgent`) can be split into queue-fed workers (SQS/RabbitMQ) without changing workflow semantics. We didn't build that for the hackathon; we built the property that makes it a refactor instead of a rewrite.

## 8. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind v4 | custom component system |
| Orchestration | Mastra 1.x (`@mastra/core`), Node 22 | agents + durable workflow + model router |
| LLM | Groq: `gpt-oss-120b` (risk, redlines, Q&A, reports), `gpt-oss-20b` (parsing metadata, classification) | these two support Groq's strict structured outputs — schema-invalid JSON is impossible at the decoder level. A schema-injection fallback keeps other models (Llama 3.3, Featherless) working. Model IDs are env vars; swapping providers is config, not code. |
| Embeddings | fastembed, local ONNX | BGE-small-en-v1.5 (dense, 384d) + SPLADE++ (sparse) |
| Vector DB | Qdrant Cloud | configuration in §9.2 |
| Safety | Enkrypt AI | `/guardrails/detect`, `/adherence`, `/relevancy` |
| Database | LibSQL + Drizzle ORM | Neon Postgres drop-in for production |
| Observability | Mastra AI tracing + custom `llm_traces` store | §6.1 |
| Deployment | Vercel (web), Railway (runtime) | GitHub Actions for CI |

## 9. Data Requirements

### 9.1 Qdrant collections

- `clause_library` — market-standard benchmarks. Payload: `clauseType`, `jurisdiction`, `riskBaseline`, `guidance`, `source`.
- `document_clauses` — live document vectors for RAG and Q&A. Payload: `documentId`, `ordinal`, `heading`, `clauseType`, `text`.
- `review_memory` — past human overrides and precedent notes. Payload: `clauseType`, `action`, `fromValue`, `toValue`, `note`. This collection is the learning loop (§17).

### 9.2 Qdrant production configuration

Applies to all three collections. Round 1 dinged us for describing these features without shipping them; they're now implemented in `agent/src/services/qdrant.ts`:

- **Named vectors:** `dense` (BGE-small, 384 dims, cosine) and `splade` (learned sparse lexical expansion). Legal text needs both — dense catches "liability cap" ≈ "damages limitation", sparse catches exact terms of art like "indemnify".
- **Hybrid retrieval:** two prefetch branches fused server-side with Reciprocal Rank Fusion, degrading gracefully to dense-only if the sparse model is unavailable (which is how the small cloud volume runs).
- **HNSW:** `m=16`, `ef_construct=200`, queries at `hnsw_ef=128`.
- **Scalar quantization:** int8, `quantile=0.99`, `always_ram=true` — roughly 4× memory reduction, with query-time rescoring against original vectors to claw the accuracy back.
- **Payload indexes** on every filterable field (`clauseType`, `jurisdiction`, `riskBaseline`, `documentId`, `action`) so filtered hybrid queries stay sub-linear.

### 9.3 Relational schema

Drizzle ORM; LibSQL now, Postgres later. Tables: `documents` (metadata, storage refs, run pointer, final report), `clauses` (verbatim text, types, scores, rationales, benchmark citations, redlines, overrides), `runs` (UI mirror of workflow state: step log, suspend payloads, correlation ID), `enkrypt_verdicts` (every safety check G1–G4 with scores, latency, response excerpt), `llm_traces` (§6.1), `qa_messages` (chat history with citations and linked verdicts), `review_feedback` (every human decision at both gates — also embedded into `review_memory`).

## 10. API Specifications

- `POST /documents` — upload, initialize record
- `POST /documents/:id/analyze` — start the workflow
- `GET /runs/:id` — SSE stream of live run state
- `POST /runs/:id/approve` — resume a suspended gate
- `POST /documents/:id/qa` — grounded Q&A
- `GET /documents/:id/audit` — Enkrypt verdicts + human decision log

## 11. Security Requirements

### 11.1 Enkrypt AI safety gates

- **G1 — risk grounding.** The risk rationale is scored by Enkrypt `/adherence` against the clause text plus the retrieved benchmarks (threshold 0.6, env-tunable). Weak grounding doesn't block — it's flagged inline for the Gate 1 reviewer, who is the right entity to judge a borderline case.
- **G2 — Q&A grounding.** Three checks: citations (`[clause:N]`) verified in code against real ordinals, adherence of the answer to the retrieved context, and relevancy of the answer to the question. A failing answer is blocked, never shown. User questions are pre-scanned with `/detect` for injection, toxicity, and NSFW before any retrieval happens.
- **G3 — redline safety.** Every generated redline goes through `/detect` (PII, toxicity, NSFW, injection, policy) plus a low-floor adherence check against the original clause. Failures are blocked with the reason recorded.
- **G4 — final compliance.** The "informational, not legal advice" disclaimer is enforced *deterministically* — if the model omitted it, code appends it. "The model usually includes it" is not compliance. A final detect scan runs on the report.

If `ENKRYPT_API_KEY` is missing or the API is unreachable, gates fall back to deterministic local checks (citation verification, regex PII scan, disclaimer enforcement) and record their verdicts with `mode: local`. Safety checks are never silently skipped — every invocation, including skips, lands in `enkrypt_verdicts`.

### 11.2 API security controls

Aligned to the OWASP API Top-10, and the other Round 1 gap:

- **Service auth:** the runtime 401s any request without the `x-agent-key` shared secret. Only the gateway holds it; browsers can't reach the runtime at all. (Roadmap: JWT/OAuth2 user auth at the gateway — the runtime contract doesn't change.)
- **Rate limiting:** token bucket per client IP at both layers; runtime default 60 req/min, `429` with `Retry-After`.
- **Input validation:** Zod on every route body; uploads gated by MIME/extension allow-list (PDF, DOCX, TXT, MD) and a 10MB cap before a single byte is written.
- **Encryption:** TLS 1.3 in transit (platform-terminated), AES-256 at rest via platform storage encryption — enforced in deployment config, documented in the runbook.
- **Data hygiene:** no raw prompts persisted anywhere (hashes only, §6.1); Mastra's `SensitiveDataFilter` on spans; keys live in platform secret managers only.
- **CORS** pinned to the deployed web origin; the correlation ID is the only custom header exposed back.

## 12. Deployment & Infrastructure

Vercel for the web tier, Railway for the Mastra runtime (a persistent volume holds the SQLite files, uploads, and the embedding-model cache). Qdrant Cloud, Groq, and Enkrypt are managed services. Postgres on Neon is the production database path. Secrets stay in the platforms' secret managers.

## 13. Success Metrics

- Upload → final report under 5 minutes for a typical contract.
- 100% of user-facing outputs pass a gate (or its audited local fallback).
- Zero ungrounded Q&A answers shown to users — by construction, since G2 blocks them.
- The one we find most interesting: **human-override rate over time**. If the learning loop (§17) works, reviewers should need to correct the system less each month. Declining overrides = the system has learned the organization's risk posture.

## 14. Timeline & Milestones

Built in four phases: core pipeline (parse/classify/index) → safety and benchmarking (Enkrypt G1/G2, clause library RAG) → the human gates and redlining (Mastra suspend/resume, redline agent) → audit trail and UI polish. All four shipped for Round 2.

## 15. Open Questions & Risks

**Groq free-tier rate limits.** The one that actually bites during demos. Mitigations are layered: deterministic-first parsing (the LLM only refines), batched classification and risk calls, inter-call pacing, exponential backoff, a 40-clause cap per document, and SSE progress so a slow run at least looks alive. Worst case, one env var flips the whole system to the Featherless fallback provider.

**Open-weight models hallucinating legal reasoning.** We assume they will. The architecture is the mitigation: G1 adherence on every rationale, code-verified citations, and two human gates. Safety comes from the pipeline, not the model brand — which is also why swapping models is a config change.

**Legal liability for AI-generated redlines.** Mandatory human approval on every redline, plus the code-enforced disclaimer (G4). The product is decision support; the disclaimer is enforced because it's true.

**Benchmark quality.** 32 seeded clauses across ~15 types is a demo library, not a product one. Production needs thousands, jurisdiction-tagged, with provenance — the `source` field on every point exists so that expansion doesn't require a schema change.

## 16. Prompt Engineering Standard (CRISPE)

All five agent system prompts follow CRISPE and live in `agent/src/mastra/agents/index.ts`: **C**ontext (what material the agent receives — clauses, benchmarks labeled `[B#]`, retrieved context labeled `[clause:N]`, prior human decisions), **R**ole (a professional persona, e.g. "conservative contract risk analyst advising the non-drafting party"), **I**nstruction (one task, stated imperatively), **S**pecifics (the hard constraints: verbatim-text rules, allowed enums, citation format, output schema), **P**ersonality (tone — "skeptical, evidence-driven, allergic to speculation"), **E**xperiment (tie-breaking guidance for ambiguous input).

Every agent output is validated against a Zod schema (`agent/src/mastra/schemas.ts`) before it enters the workflow. Malformed generations are retried with backoff and a JSON-repair fallback — never passed downstream. Combined with Groq's constrained decoding (§8), invented enum values are structurally impossible.

## 17. Human-Feedback Learning Loop

Both gates feed the same loop:

1. Every reviewer decision — a risk override with its note at Gate 1, an approve/edit/reject per redline at Gate 2 — is persisted to `review_feedback` with before/after values.
2. Each decision is embedded (dense + sparse) and upserted into `review_memory`, keyed by clause type.
3. Every future risk analysis queries `review_memory` for similar clauses and injects prior rulings into the prompt, with the explicit instruction that human precedent overrides the model's instinct.

No fine-tuning involved, deliberately: retrieval-based memory is instant (no training job), inspectable (every memory is a readable record), and reversible (delete the record to unlearn it). The measurable effect is the declining override rate in §13 — we demonstrated it live with a warranty clause that scored medium/45 before a human override and low/15 on the next contract, with the rationale citing the reviewer's earlier decision.

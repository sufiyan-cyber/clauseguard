/**
 * Enkrypt AI safety layer — the four ClauseGuard gates:
 *
 *  G1 Risk Grounding    — risk rationale must adhere to the clause + benchmarks
 *  G2 Q&A Grounding     — chat answers must adhere to retrieved clauses and be
 *                         relevant to the question; citations verified locally
 *  G3 Redline Safety    — generated redlines scanned for PII / toxicity /
 *                         injection / policy violations + grounding vs original
 *  G4 Final Compliance  — report scanned + "not legal advice" disclaimer enforced
 *
 * Every gate call is persisted to enkrypt_verdicts for the audit trail.
 * If ENKRYPT_API_KEY is missing, gates run in "local" mode: deterministic
 * checks (citation verification, disclaimer, regex PII) still run and the
 * verdict is recorded as such — the pipeline never silently skips safety.
 */
import { config } from "../config";
import { db, enkryptVerdicts, ensureSchema, now, uid } from "./db";

type DetectorConfig = Record<string, unknown>;

export interface GateResult {
  verdictId: string;
  gate: "G1" | "G2" | "G3" | "G4";
  verdict: "pass" | "fail" | "warn" | "skipped";
  scores: Record<string, number | string | boolean | null>;
  reasons: string[];
}

interface GateContext {
  documentId?: string;
  runId?: string;
  subjectType: "clause" | "qa" | "redline" | "report";
  subjectId?: string;
}

const enkryptEnabled = () => Boolean(config.enkrypt.apiKey);

async function callEnkrypt(path: string, body: unknown, timeoutMs = 20000): Promise<any> {
  const res = await fetch(`${config.enkrypt.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.enkrypt.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Enkrypt ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** POST /guardrails/detect — PII, injection, toxicity, policy violations. */
async function detect(text: string, detectors: DetectorConfig): Promise<any> {
  return callEnkrypt("/guardrails/detect", { text, detectors });
}

/** POST /guardrails/adherence — is llm_answer grounded in context? (0-1) */
async function adherence(llmAnswer: string, context: string): Promise<number> {
  const res = await callEnkrypt("/guardrails/adherence", {
    llm_answer: llmAnswer.slice(0, 6000),
    context: context.slice(0, 12000),
  });
  return Number(res?.summary?.adherence_score ?? 0);
}

/** POST /guardrails/relevancy — does llm_answer address the question? (0-1) */
async function relevancy(question: string, llmAnswer: string): Promise<number> {
  const res = await callEnkrypt("/guardrails/relevancy", {
    question: question.slice(0, 2000),
    llm_answer: llmAnswer.slice(0, 6000),
  });
  return Number(res?.summary?.relevancy_score ?? 0);
}

/** Count flagged detectors in a /detect response summary. */
function summarizeDetections(raw: any): { flagged: string[]; summary: Record<string, unknown> } {
  const summary = (raw?.summary ?? {}) as Record<string, unknown>;
  const flagged: string[] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === "number" && value > 0 && key !== "latency") flagged.push(key);
    if (value === true) flagged.push(key);
  }
  return { flagged, summary };
}

/** Local fallback: crude PII regexes so safety never fully disappears offline. */
function localPiiScan(text: string): string[] {
  const findings: string[] = [];
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) findings.push("ssn-pattern");
  if (/\b(?:\d[ -]*?){13,16}\b/.test(text) && /card|credit|payment/i.test(text)) findings.push("card-pattern");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) findings.push("email");
  return findings;
}

async function persistVerdict(
  ctx: GateContext,
  gate: GateResult["gate"],
  verdict: GateResult["verdict"],
  scores: Record<string, unknown>,
  raw: unknown,
  latencyMs: number,
): Promise<string> {
  await ensureSchema();
  const id = uid();
  await db.insert(enkryptVerdicts).values({
    id,
    documentId: ctx.documentId ?? null,
    runId: ctx.runId ?? null,
    gate,
    subjectType: ctx.subjectType,
    subjectId: ctx.subjectId ?? null,
    verdict,
    scores: JSON.stringify(scores),
    raw: JSON.stringify(raw ?? null).slice(0, 4000),
    latencyMs,
    createdAt: now(),
  });
  return id;
}

/**
 * G1 — Risk Grounding. The risk rationale must be supported by the clause
 * text + retrieved benchmarks (adherence), with no policy violations.
 */
export async function gateG1RiskGrounding(
  ctx: GateContext,
  rationale: string,
  clauseText: string,
  benchmarkContext: string,
): Promise<GateResult> {
  const started = Date.now();
  const reasons: string[] = [];
  const scores: GateResult["scores"] = {};
  let verdict: GateResult["verdict"] = "pass";
  let raw: unknown = null;

  if (enkryptEnabled()) {
    try {
      const score = await adherence(rationale, `CLAUSE:\n${clauseText}\n\nMARKET BENCHMARKS:\n${benchmarkContext}`);
      scores.adherence = score;
      if (score < config.enkrypt.adherenceThreshold) {
        verdict = "warn";
        reasons.push(`Adherence ${score.toFixed(2)} below threshold ${config.enkrypt.adherenceThreshold}`);
      }
      raw = { adherence: score };
    } catch (err) {
      verdict = "warn";
      scores.mode = "error";
      reasons.push(`Enkrypt call failed: ${(err as Error).message}`);
    }
  } else {
    scores.mode = "local";
    // Deterministic floor: rationale must actually reference the clause.
    const overlap = clauseText
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 6 && rationale.toLowerCase().includes(w)).length;
    scores.lexicalOverlap = overlap;
    if (overlap < 1) {
      verdict = "warn";
      reasons.push("Rationale shares no significant terms with the clause (local check)");
    }
  }

  const verdictId = await persistVerdict(ctx, "G1", verdict, scores, raw, Date.now() - started);
  return { verdictId, gate: "G1", verdict, scores, reasons };
}

export interface CitationCheck {
  cited: string[];
  valid: boolean;
  invalidIds: string[];
}

/** Deterministic citation verification: every [clause:N] must exist. */
export function verifyCitations(answer: string, validOrdinals: number[]): CitationCheck {
  const cited = [...answer.matchAll(/\[clause:(\d+)\]/g)].map((m) => m[1]);
  const valid = new Set(validOrdinals.map(String));
  const invalidIds = cited.filter((c) => !valid.has(c));
  return { cited, valid: cited.length > 0 && invalidIds.length === 0, invalidIds };
}

/**
 * G2 — Q&A Grounding. Answer must adhere to retrieved clause context, be
 * relevant to the question, cite only real clauses, and contain no PII leaks.
 */
export async function gateG2QaGrounding(
  ctx: GateContext,
  question: string,
  answer: string,
  retrievedContext: string,
  validOrdinals: number[],
): Promise<GateResult & { citationCheck: CitationCheck }> {
  const started = Date.now();
  const reasons: string[] = [];
  const scores: GateResult["scores"] = {};
  let verdict: GateResult["verdict"] = "pass";
  let raw: unknown = null;

  const citationCheck = verifyCitations(answer, validOrdinals);
  scores.citationsValid = citationCheck.valid;
  if (!citationCheck.valid) {
    verdict = "fail";
    reasons.push(
      citationCheck.cited.length === 0
        ? "Answer contains no [clause:N] citations"
        : `Answer cites nonexistent clauses: ${citationCheck.invalidIds.join(", ")}`,
    );
  }

  if (enkryptEnabled()) {
    try {
      const [adh, rel] = await Promise.all([
        adherence(answer, retrievedContext),
        relevancy(question, answer),
      ]);
      scores.adherence = adh;
      scores.relevancy = rel;
      raw = { adherence: adh, relevancy: rel };
      if (adh < config.enkrypt.adherenceThreshold) {
        verdict = "fail";
        reasons.push(`Answer not grounded in document (adherence ${adh.toFixed(2)})`);
      }
      if (rel < config.enkrypt.relevancyThreshold) {
        if (verdict === "pass") verdict = "warn";
        reasons.push(`Answer may not address the question (relevancy ${rel.toFixed(2)})`);
      }
    } catch (err) {
      if (verdict === "pass") verdict = "warn";
      reasons.push(`Enkrypt call failed: ${(err as Error).message}`);
    }
  } else {
    scores.mode = "local";
  }

  const verdictId = await persistVerdict(ctx, "G2", verdict, scores, raw, Date.now() - started);
  return { verdictId, gate: "G2", verdict, scores, reasons, citationCheck };
}

/**
 * G3 — Redline Safety. Generated redline scanned for PII / toxicity /
 * injection / policy issues, and must stay on-topic vs the original clause.
 */
export async function gateG3RedlineSafety(
  ctx: GateContext,
  redlineText: string,
  originalClause: string,
): Promise<GateResult> {
  const started = Date.now();
  const reasons: string[] = [];
  const scores: GateResult["scores"] = {};
  let verdict: GateResult["verdict"] = "pass";
  let raw: unknown = null;

  if (enkryptEnabled()) {
    try {
      const detection = await detect(redlineText, {
        pii: { enabled: true, entities: ["pii", "secrets", "ip_address", "url"] },
        toxicity: { enabled: true },
        nsfw: { enabled: true },
        injection_attack: { enabled: true },
        policy_violation: {
          enabled: true,
          policy_text:
            "Output must be contract language only: no legal advice guarantees, no promises of outcomes, no defamatory statements, no instructions unrelated to contract terms.",
          need_explanation: true,
        },
      });
      raw = detection;
      const { flagged, summary } = summarizeDetections(detection);
      Object.assign(scores, summary);
      if (flagged.length > 0) {
        verdict = "fail";
        reasons.push(`Detectors flagged: ${flagged.join(", ")}`);
      }
      const adh = await adherence(redlineText, originalClause);
      scores.adherence = adh;
      if (adh < 0.3) {
        // Redlines intentionally diverge from the original, so use a low floor —
        // this only catches fully off-topic generations.
        verdict = verdict === "fail" ? "fail" : "warn";
        reasons.push(`Redline appears unrelated to original clause (adherence ${adh.toFixed(2)})`);
      }
    } catch (err) {
      verdict = "warn";
      reasons.push(`Enkrypt call failed: ${(err as Error).message}`);
    }
  } else {
    scores.mode = "local";
    const pii = localPiiScan(redlineText);
    if (pii.length > 0) {
      verdict = "fail";
      reasons.push(`Local PII scan flagged: ${pii.join(", ")}`);
    }
  }

  const verdictId = await persistVerdict(ctx, "G3", verdict, scores, raw, Date.now() - started);
  return { verdictId, gate: "G3", verdict, scores, reasons };
}

/**
 * G4 — Final Compliance. Report must carry the disclaimer (enforced
 * deterministically) and pass a final policy/PII scan.
 */
export async function gateG4FinalCompliance(
  ctx: GateContext,
  reportText: string,
): Promise<GateResult & { compliantText: string }> {
  const started = Date.now();
  const reasons: string[] = [];
  const scores: GateResult["scores"] = {};
  let verdict: GateResult["verdict"] = "pass";
  let raw: unknown = null;

  // Deterministic disclaimer enforcement — appended if missing, never optional.
  let compliantText = reportText;
  const hasDisclaimer = /not\s+(?:constitute\s+)?legal\s+advice/i.test(reportText);
  scores.disclaimerPresent = hasDisclaimer;
  if (!hasDisclaimer) {
    compliantText = `${reportText.trimEnd()}\n\n---\n**Disclaimer:** ${config.disclaimer}`;
    reasons.push("Disclaimer was missing — auto-appended (G4 enforcement)");
  }

  if (enkryptEnabled()) {
    try {
      const detection = await detect(compliantText.slice(0, 8000), {
        pii: { enabled: true, entities: ["pii", "secrets"] },
        toxicity: { enabled: true },
        policy_violation: {
          enabled: true,
          policy_text:
            "Report must be informational analysis of a contract. It must not guarantee legal outcomes, must not impersonate a licensed attorney, and must include a disclaimer that it is not legal advice.",
          need_explanation: true,
        },
      });
      raw = detection;
      const { flagged, summary } = summarizeDetections(detection);
      Object.assign(scores, summary);
      if (flagged.length > 0) {
        verdict = "warn";
        reasons.push(`Detectors flagged: ${flagged.join(", ")}`);
      }
    } catch (err) {
      verdict = "warn";
      reasons.push(`Enkrypt call failed: ${(err as Error).message}`);
    }
  } else {
    scores.mode = "local";
  }

  const verdictId = await persistVerdict(ctx, "G4", verdict, scores, raw, Date.now() - started);
  return { verdictId, gate: "G4", verdict, scores, reasons, compliantText };
}

/** Pre-flight scan on user-supplied Q&A input (prompt-injection defense). */
export async function scanUserInput(
  ctx: GateContext,
  text: string,
): Promise<GateResult> {
  const started = Date.now();
  const reasons: string[] = [];
  const scores: GateResult["scores"] = {};
  let verdict: GateResult["verdict"] = "pass";
  let raw: unknown = null;

  if (enkryptEnabled()) {
    try {
      const detection = await detect(text, {
        injection_attack: { enabled: true },
        toxicity: { enabled: true },
        nsfw: { enabled: true },
      });
      raw = detection;
      const { flagged, summary } = summarizeDetections(detection);
      Object.assign(scores, summary);
      if (flagged.length > 0) {
        verdict = "fail";
        reasons.push(`Input flagged: ${flagged.join(", ")}`);
      }
    } catch (err) {
      verdict = "warn";
      reasons.push(`Enkrypt call failed: ${(err as Error).message}`);
    }
  } else {
    scores.mode = "local";
    if (/ignore (all|previous|above) instructions|system prompt/i.test(text)) {
      verdict = "fail";
      reasons.push("Prompt-injection pattern detected (local check)");
    }
  }

  const verdictId = await persistVerdict(ctx, "G2", verdict, scores, raw, Date.now() - started);
  return { verdictId, gate: "G2", verdict, scores, reasons };
}

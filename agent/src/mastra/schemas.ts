/**
 * Strict JSON schemas for agent-to-agent communication.
 * Every agent output is validated against these before entering the workflow —
 * a malformed generation is retried, never silently passed downstream.
 */
import { z } from "zod";

export const CLAUSE_TYPES = [
  "indemnification",
  "limitation_of_liability",
  "termination",
  "confidentiality",
  "intellectual_property",
  "payment_terms",
  "auto_renewal",
  "non_compete",
  "non_solicitation",
  "governing_law",
  "dispute_resolution",
  "warranty",
  "data_protection",
  "force_majeure",
  "assignment",
  "insurance",
  "audit_rights",
  "service_levels",
  "publicity",
  "other",
] as const;

export const clauseTypeSchema = z.enum(CLAUSE_TYPES);

// ---------------------------------------------------------------------------
// docParserAgent
// ---------------------------------------------------------------------------
export const parsedClausesSchema = z.object({
  documentTitle: z.string().describe("Short human-readable title for the document"),
  documentType: z
    .string()
    .describe("Kind of agreement, e.g. 'Master Services Agreement', 'NDA'"),
  clauses: z
    .array(
      z.object({
        ordinal: z.number().int().min(1).describe("1-based clause number in document order"),
        heading: z.string().nullable().describe("Clause heading if present, else null"),
        text: z.string().min(1).describe("Verbatim clause text — never paraphrased"),
      }),
    )
    .min(1),
});
export type ParsedClauses = z.infer<typeof parsedClausesSchema>;

// ---------------------------------------------------------------------------
// clauseClassifierAgent
// ---------------------------------------------------------------------------
export const classifiedClausesSchema = z.object({
  classifications: z
    .array(
      z.object({
        ordinal: z.number().int().min(1),
        clauseType: clauseTypeSchema,
        keyTerms: z
          .array(z.string())
          .max(6)
          .describe("Up to 6 defined terms / key obligations found in the clause"),
      }),
    )
    .min(1),
});
export type ClassifiedClauses = z.infer<typeof classifiedClausesSchema>;

// ---------------------------------------------------------------------------
// riskAnalysisAgent
// ---------------------------------------------------------------------------
export const riskFindingsSchema = z.object({
  findings: z
    .array(
      z.object({
        ordinal: z.number().int().min(1),
        riskLevel: z.enum(["low", "medium", "high"]),
        riskScore: z.number().int().min(0).max(100).describe("0 = market standard, 100 = extreme risk"),
        rationale: z
          .string()
          .describe("2-4 sentences: why risky, quoting the clause and citing benchmarks by [B#]"),
        deviations: z
          .array(z.string())
          .max(4)
          .describe("Specific ways this clause deviates from the market benchmarks"),
      }),
    )
    .min(1),
});
export type RiskFindings = z.infer<typeof riskFindingsSchema>;

// ---------------------------------------------------------------------------
// redlineAgent
// ---------------------------------------------------------------------------
export const redlineSchema = z.object({
  redlineText: z.string().min(1).describe("Complete replacement clause text, ready to paste"),
  rationale: z
    .string()
    .describe("2-3 sentences: what changed and which risk each change mitigates"),
  changes: z
    .array(
      z.object({
        from: z.string().describe("Short quote of the original risky language"),
        to: z.string().describe("Short quote of the replacement language"),
      }),
    )
    .max(6),
});
export type Redline = z.infer<typeof redlineSchema>;

// ---------------------------------------------------------------------------
// legalQaAgent
// ---------------------------------------------------------------------------
export const qaAnswerSchema = z.object({
  answer: z
    .string()
    .describe(
      "Plain-language answer. Every factual claim must carry an inline citation like [clause:3].",
    ),
  citations: z
    .array(
      z.object({
        ordinal: z.number().int().min(1).describe("Clause number being cited"),
        quote: z.string().describe("Short verbatim quote (<=160 chars) supporting the claim"),
      }),
    )
    .describe("Every clause cited in the answer, with its supporting quote"),
  confidence: z.enum(["high", "medium", "low"]),
  notFound: z
    .boolean()
    .describe("true when the document does not contain the information asked about"),
});
export type QaAnswer = z.infer<typeof qaAnswerSchema>;

// ---------------------------------------------------------------------------
// report compiler (uses riskAnalysisAgent)
// ---------------------------------------------------------------------------
export const reportSchema = z.object({
  executiveSummary: z.string().describe("3-5 sentence plain-language summary for a non-lawyer"),
  overallRisk: z.enum(["low", "medium", "high"]),
  topConcerns: z.array(z.string()).max(5).describe("Highest-impact issues, most severe first"),
  recommendations: z.array(z.string()).max(5).describe("Concrete next steps for the reviewer"),
});
export type Report = z.infer<typeof reportSchema>;

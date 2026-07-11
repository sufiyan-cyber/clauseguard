/**
 * Document text extraction (deterministic — no LLM involved).
 * PDF via unpdf (pdfjs, pure ESM), DOCX via mammoth, plus plain text.
 *
 * Segmentation strategy is a three-tier deterministic cascade, so parsing
 * NEVER depends on an LLM call succeeding:
 *   1. Numbered-heading split (ARTICLE 4 / Section 2.1 / "7." …)
 *   2. Blank-line paragraph blocks
 *   3. Sentence-boundary windows (~900 chars) — always succeeds
 */
import { readFile } from "node:fs/promises";
import mammoth from "mammoth";

export async function extractText(path: string, mime: string): Promise<string> {
  if (mime === "application/pdf" || path.toLowerCase().endsWith(".pdf")) {
    const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
    const buffer = await readFile(path);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return normalizePdf(String(text));
  }
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    path.toLowerCase().endsWith(".docx")
  ) {
    const { value } = await mammoth.extractRawText({ path });
    return normalize(value);
  }
  // Fallback: treat as UTF-8 text (.txt, .md)
  const raw = await readFile(path, "utf-8");
  return normalize(raw);
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * PDF extraction artifacts: hyphenated line wraps, hard-wrapped sentences,
 * repeated page furniture. Conservatively repair before segmentation.
 */
function normalizePdf(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  // Rejoin words hyphen-split across line wraps: "confiden-\ntial" → "confidential"
  t = t.replace(/([a-z])-\n([a-z])/g, "$1$2");
  // A line break followed by a lowercase letter is almost always a wrapped
  // sentence, not a new clause — join it. Heading-like lines stay intact.
  t = t.replace(/([a-z,;])\n(?=[a-z(])/g, "$1 ");
  return normalize(t);
}

export interface RawSegment {
  ordinal: number;
  heading: string | null;
  text: string;
}

const HEADING_RE =
  /^(?:(?:ARTICLE|SECTION|CLAUSE|Section|Article|Clause)\s+[\dIVXLC]+[.:)]?|\d{1,2}(?:\.\d{1,2})*[.)]\s+\S)/;

/** Tier 1: split on numbered headings. */
function headingSegments(text: string): Array<{ heading: string | null; body: string }> {
  const lines = text.split("\n");
  const segments: Array<{ heading: string | null; body: string[] }> = [];
  let current: { heading: string | null; body: string[] } | null = null;

  const push = () => {
    if (current && current.body.join(" ").trim().length > 40) segments.push(current);
    current = null;
  };

  for (const line of lines) {
    if (HEADING_RE.test(line.trim())) {
      push();
      current = { heading: line.trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    } else if (line.trim().length > 0) {
      current = { heading: null, body: [line] };
    }
  }
  push();
  return segments.map((s) => ({
    heading: s.heading,
    body: [s.heading, ...s.body].filter(Boolean).join("\n").trim(),
  }));
}

/** Tier 2: blank-line paragraph blocks. */
function paragraphSegments(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 60);
}

/**
 * Tier 3: sentence-boundary windows. Deterministic and total — works on any
 * text, guaranteeing segmentation can never fail outright.
 */
export function windowSegments(text: string, targetChars = 900): string[] {
  const sentences = text.replace(/\n+/g, " ").match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [text];
  const windows: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    if (buffer.length + sentence.length > targetChars && buffer.trim().length > 0) {
      windows.push(buffer.trim());
      buffer = "";
    }
    buffer += sentence;
  }
  if (buffer.trim().length > 40) windows.push(buffer.trim());
  return windows;
}

/**
 * Deterministic pre-segmentation cascade. Always returns at least one
 * segment for any text ≥ ~100 chars; LLM involvement is optional refinement.
 */
export function preSegment(text: string, maxSegments: number): RawSegment[] {
  // Tier 1 — numbered headings
  const headed = headingSegments(text);
  if (headed.length >= 3) {
    return headed
      .slice(0, maxSegments)
      .map((s, i) => ({ ordinal: i + 1, heading: s.heading, text: s.body }));
  }

  // Tier 2 — paragraph blocks
  const paragraphs = paragraphSegments(text);
  if (paragraphs.length >= 3) {
    return paragraphs
      .slice(0, maxSegments)
      .map((b, i) => ({ ordinal: i + 1, heading: null, text: b }));
  }

  // Tier 3 — sentence windows (total function; cannot fail)
  return windowSegments(text)
    .slice(0, maxSegments)
    .map((b, i) => ({ ordinal: i + 1, heading: null, text: b }));
}

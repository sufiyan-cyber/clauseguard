"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Citation, QaMessage } from "@/lib/types";
import { IconMessageSquare, IconSend, IconShieldX } from "@/components/icons";
import { Button, Chip, Spinner } from "@/components/ui";

const SUGGESTIONS = [
  "Can the vendor raise prices without telling us?",
  "What happens to our data if we cancel?",
  "Can we get a refund if they breach the contract?",
  "Is there a non-compete hidden in here?",
];

export function QaChat({
  documentId,
  onCitationClick,
}: {
  documentId: string;
  onCitationClick: (ordinal: number) => void;
}) {
  const [messages, setMessages] = useState<QaMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getQaHistory(documentId)
      .then((r) => setMessages(r.messages))
      .catch(() => {});
  }, [documentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const ask = async (question: string) => {
    if (!question.trim() || loading) return;
    setError(null);
    setLoading(true);
    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        role: "user",
        content: question,
        citations: [],
        verdictId: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const res = await api.askQuestion(documentId, question);
      setMessages((prev) => [
        ...prev,
        {
          id: res.messageId,
          role: "assistant",
          content: res.answer,
          citations: res.citations,
          verdictId: res.gate.verdictId,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      const msg = (err as Error).message;
      if (/^Blocked by Enkrypt/i.test(msg)) {
        // Injection scan rejected the question — show it as a blocked bubble, not a raw error
        setMessages((prev) => [
          ...prev,
          {
            id: `blocked-${Date.now()}`,
            role: "assistant",
            content: msg,
            citations: [],
            verdictId: null,
            createdAt: new Date().toISOString(),
          },
        ]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-rise rounded-xl border border-edge bg-surface">
      <div className="max-h-[52vh] min-h-64 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && !loading && (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl border border-edge bg-raised text-brand-strong">
              <IconMessageSquare size={18} />
            </div>
            <p className="text-sm font-semibold text-ink-dim">
              Ask anything about this contract — answers cite exact clauses.
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-faint">
              Retrieval runs hybrid (dense + SPLADE) over this document only; every answer must
              pass Enkrypt G2 grounding or it&apos;s blocked.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-edge px-3 py-1.5 text-xs text-ink-dim transition hover:border-brand/50 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onCitationClick={onCitationClick} />
        ))}
        {loading && <Spinner label="legalQaAgent retrieving & answering (G2 gate pending)…" />}
        {error && <p className="text-xs text-risk-high">{error}</p>}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex gap-2 border-t border-edge p-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          className="min-h-10 flex-1 rounded-lg border border-edge bg-raised px-3.5 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand/60 focus:outline-none"
          placeholder="e.g. What's the liability cap if something goes wrong?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          aria-label="Ask a question about this contract"
        />
        <Button type="submit" disabled={loading || !input.trim()} ariaLabel="Send question">
          <IconSend size={14} />
          Ask
        </Button>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  onCitationClick,
}: {
  message: QaMessage;
  onCitationClick: (ordinal: number) => void;
}) {
  const isUser = message.role === "user";
  const blocked =
    !isUser && /failed the grounding check|blocked by enkrypt/i.test(message.content);

  // Render [clause:N] tokens as clickable chips
  const parts = message.content.split(/(\[clause:\d+\])/g);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-brand-soft text-ink"
            : blocked
              ? "border border-risk-high/40 bg-risk-high/10 text-ink"
              : "border border-edge bg-raised text-ink"
        }`}
      >
        {blocked && (
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-risk-high">
            <IconShieldX size={12} /> blocked by Enkrypt
          </p>
        )}
        <p className="whitespace-pre-wrap">
          {parts.map((part, i) => {
            const match = part.match(/^\[clause:(\d+)\]$/);
            if (!match) return <span key={i}>{part}</span>;
            const ordinal = Number(match[1]);
            return (
              <button
                key={i}
                onClick={() => onCitationClick(ordinal)}
                className="mx-0.5 inline-flex -translate-y-px items-center rounded border border-brand/40 bg-brand/10 px-1.5 font-mono text-[10px] font-bold text-brand transition hover:bg-brand/25"
              >
                §{ordinal}
              </button>
            );
          })}
        </p>
        {!isUser && message.citations.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-edge/60 pt-2">
            {message.citations.map((c: Citation, i) => (
              <button
                key={i}
                onClick={() => onCitationClick(c.ordinal)}
                className="block text-left text-[11px] leading-snug text-ink-faint transition hover:text-ink-dim"
              >
                <span className="font-mono font-bold text-brand">§{c.ordinal}</span> “
                {c.quote.slice(0, 120)}
                {c.quote.length > 120 ? "…" : ""}”
              </button>
            ))}
          </div>
        )}
        {!isUser && !blocked && message.verdictId && (
          <p className="mt-2 text-[10px] text-ink-faint">
            <Chip tone="pass">G2 verified</Chip>
          </p>
        )}
      </div>
    </div>
  );
}

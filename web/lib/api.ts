/** Browser-side API client — everything goes through the /api/agent gateway. */

const base = "/api/agent";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const data = body as { error?: string; blocked?: boolean; reasons?: string[] } | null;
    const message = data?.blocked
      ? `Blocked by Enkrypt input scan${data.reasons?.length ? `: ${data.reasons.join("; ")}` : ""}`
      : (data?.error ?? `Request failed (${res.status})`);
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  listDocuments: () => request<{ documents: import("./types").DocumentSummary[] }>("/documents"),
  getDocument: (id: string) => request<import("./types").DocumentDetail>(`/documents/${id}`),
  uploadDocument: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ documentId: string }>("/documents", { method: "POST", body: form });
  },
  analyze: (id: string) =>
    request<{ runId: string }>(`/documents/${id}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  getRun: (runId: string) => request<import("./types").RunState>(`/runs/${runId}`),
  approve: (runId: string, body: unknown) =>
    request<{ resumed: boolean }>(`/runs/${runId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  askQuestion: (documentId: string, question: string) =>
    request<import("./types").QaResponse>(`/documents/${documentId}/qa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  getQaHistory: (documentId: string) =>
    request<{ messages: import("./types").QaMessage[] }>(`/documents/${documentId}/qa`),
  getAudit: (documentId: string) =>
    request<{
      verdicts: import("./types").Verdict[];
      humanFeedback: import("./types").HumanFeedback[];
    }>(`/documents/${documentId}/audit`),
  getTraces: (documentId?: string) =>
    request<import("./types").TracesResponse>(
      `/observability/traces${documentId ? `?documentId=${documentId}` : ""}`,
    ),
  health: () =>
    request<{
      status: string;
      groqKey: boolean;
      enkryptKey: boolean;
      qdrant: string;
      models: { reasoning: string; fast: string };
    }>("/health"),
};

/** Subscribe to a run's SSE stream; returns an unsubscribe function. */
export function subscribeToRun(
  runId: string,
  onUpdate: (run: import("./types").RunState) => void,
  onDone?: () => void,
): () => void {
  const source = new EventSource(`${base}/runs/${runId}/stream`);
  source.addEventListener("run", (e) => {
    try {
      onUpdate(JSON.parse((e as MessageEvent).data));
    } catch {
      /* malformed frame — skip */
    }
  });
  source.addEventListener("done", (e) => {
    try {
      onUpdate(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore */
    }
    source.close();
    onDone?.();
  });
  source.onerror = () => {
    /* EventSource auto-reconnects; terminal states arrive via "done" */
  };
  return () => source.close();
}

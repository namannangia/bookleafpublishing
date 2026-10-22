import { useQuery } from "@tanstack/react-query";
import { ErrorState, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import type { Stats } from "../../lib/types";

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

/** How the AI is doing: cost, reliability, and how often the team corrects it. */
export function InsightsPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["stats"], queryFn: () => api.get<Stats>("/admin/stats") });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const { ai, quality } = data;
  const aiReplies = quality.draftsSent;

  return (
    <div className="page">
      <h1>AI Insights</h1>
      <p className="muted">
        Last {ai.windowDays} days. AI status:{" "}
        <strong>{ai.status === "ok" ? "Healthy" : ai.status === "degraded" ? "Degraded (falling back to rules)" : "Not configured"}</strong>
      </p>

      <h2 className="section-title">Cost & reliability</h2>
      <section className="stat-row">
        <Metric label="AI calls" value={ai.calls.toLocaleString()} note={`${ai.byPurpose.classify} triage · ${ai.byPurpose.draft} drafts`} />
        <Metric label="Estimated spend" value={`$${ai.estimatedCostUsd.toFixed(4)}`} note="From logged token usage" />
        <Metric
          label="Tokens"
          value={(ai.inputTokens + ai.outputTokens).toLocaleString()}
          note={`${ai.inputTokens.toLocaleString()} in · ${ai.outputTokens.toLocaleString()} out · ${ai.cacheReadTokens.toLocaleString()} cached`}
        />
        <Metric label="Failure rate" value={pct(ai.failures, ai.calls)} note={`Avg latency ${ai.avgLatencyMs} ms`} />
      </section>

      <h2 className="section-title">Quality signals</h2>
      <section className="stat-row">
        <Metric
          label="Triage accepted"
          value={pct(quality.aiTriaged - quality.categoryOverrides, quality.aiTriaged)}
          note={`${quality.categoryOverrides} category / ${quality.priorityOverrides} priority overrides of ${quality.aiTriaged} AI-triaged`}
        />
        <Metric
          label="Replies using AI drafts"
          value={pct(aiReplies, aiReplies + quality.manualReplies)}
          note={`${aiReplies} AI-assisted · ${quality.manualReplies} written manually`}
        />
        <Metric
          label="Drafts sent unedited"
          value={pct(quality.draftsSentUnedited, aiReplies)}
          note="A high rate means drafts are right first time"
        />
      </section>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

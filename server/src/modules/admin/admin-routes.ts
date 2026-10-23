import { and, asc, count, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import type { Db } from "../../db/client.js";
import { aiCalls, ticketEvents, ticketMessages, tickets, users } from "../../db/schema.js";
import { SLA_HOURS, UNRESOLVED_STATUSES } from "../../domain.js";
import { handler } from "../../lib/http.js";

/**
 * USD per million tokens, for the cost estimate in the admin UI. DeepSeek rows use
 * peak-hour rates (off-peak is half), so the estimate errs high.
 */
const PRICING: Record<string, { input: number; cacheRead: number; cacheWrite: number; output: number }> = {
  "deepseek-flash": { input: 0.3, cacheRead: 0.006, cacheWrite: 0.3, output: 1.2 },
  "deepseek-v4-pro": { input: 1.32, cacheRead: 0.044, cacheWrite: 1.32, output: 3.96 },
  "claude-haiku-5-5": { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
};

export function adminRoutes(deps: { db: Db; aiStatus: () => "ok" | "degraded" | "disabled" }) {
  const { db } = deps;
  const router = Router();

  /** Team members tickets can be assigned to. */
  router.get(
    "/team",
    handler(async (_req, res) => {
      const items = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.role, "ADMIN"))
        .orderBy(asc(users.name));
      res.json({ items });
    }),
  );

  /** Queue health and AI cost/quality metrics for the dashboard header and insights page. */
  router.get(
    "/stats",
    handler(async (_req, res) => {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const unresolved = inArray(tickets.status, UNRESOLVED_STATUSES);
      // First-response SLA breach, computed in SQL so it scales with the queue.
      const hours = (n: number) => sql.raw(String(Math.trunc(n)));
      const breached = sql`${tickets.firstResponseAt} is null and now() > ${tickets.createdAt} + (case ${tickets.priority}
        when 'CRITICAL' then ${hours(SLA_HOURS.CRITICAL)} when 'MEDIUM' then ${hours(SLA_HOURS.MEDIUM)}
        when 'LOW' then ${hours(SLA_HOURS.LOW)} else ${hours(SLA_HOURS.HIGH)} end) * interval '1 hour'`;

      const [queue] = await db
        .select({
          open: count(sql`case when ${tickets.status} = 'OPEN' then 1 end`),
          inProgress: count(sql`case when ${tickets.status} = 'IN_PROGRESS' then 1 end`),
          unassigned: count(sql`case when ${unresolved} and ${tickets.assigneeId} is null then 1 end`),
          critical: count(sql`case when ${unresolved} and ${tickets.priority} = 'CRITICAL' then 1 end`),
          slaBreached: count(sql`case when ${unresolved} and ${breached} then 1 end`),
          awaitingTriage: count(sql`case when ${tickets.triageState} = 'PENDING' then 1 end`),
        })
        .from(tickets);

      const callRows = await db
        .select({
          model: aiCalls.model,
          purpose: aiCalls.purpose,
          outcome: aiCalls.outcome,
          calls: count(),
          inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)::int`,
          cacheReadTokens: sql<number>`coalesce(sum(${aiCalls.cacheReadTokens}), 0)::int`,
          cacheWriteTokens: sql<number>`coalesce(sum(${aiCalls.cacheWriteTokens}), 0)::int`,
          avgLatencyMs: sql<number>`coalesce(avg(${aiCalls.latencyMs}), 0)::int`,
        })
        .from(aiCalls)
        .where(gte(aiCalls.createdAt, since))
        .groupBy(aiCalls.model, aiCalls.purpose, aiCalls.outcome);

      let estimatedCostUsd = 0;
      for (const r of callRows) {
        const price = PRICING[r.model];
        if (!price) continue;
        estimatedCostUsd +=
          (r.inputTokens * price.input +
            r.cacheReadTokens * price.cacheRead +
            r.cacheWriteTokens * price.cacheWrite +
            r.outputTokens * price.output) /
          1e6;
      }
      const sum = (pick: (r: (typeof callRows)[number]) => number, filter = (_: (typeof callRows)[number]) => true) =>
        callRows.filter(filter).reduce((s, r) => s + pick(r), 0);

      // Accuracy proxies: how often admins override AI triage, and how often drafts go out unedited.
      const [triage] = await db
        .select({
          aiTriaged: count(sql`case when ${ticketEvents.type} = 'triaged' and ${ticketEvents.data}->>'source' = 'AI' then 1 end`),
          categoryOverrides: count(
            sql`case when ${ticketEvents.type} = 'category_overridden' and ${ticketEvents.data}->>'previousSource' = 'AI' then 1 end`,
          ),
          priorityOverrides: count(
            sql`case when ${ticketEvents.type} = 'priority_overridden' and ${ticketEvents.data}->>'previousSource' = 'AI' then 1 end`,
          ),
        })
        .from(ticketEvents);
      const [drafts] = await db
        .select({
          sent: count(),
          unedited: count(sql`case when ${ticketMessages.aiDraftEdited} = false then 1 end`),
        })
        .from(ticketMessages)
        .where(and(isNotNull(ticketMessages.aiDraftId), eq(ticketMessages.senderRole, "ADMIN")));
      const [manual] = await db
        .select({ count: count() })
        .from(ticketMessages)
        .where(and(isNull(ticketMessages.aiDraftId), eq(ticketMessages.senderRole, "ADMIN")));

      res.json({
        queue,
        ai: {
          status: deps.aiStatus(),
          windowDays: 7,
          calls: sum((r) => r.calls),
          failures: sum((r) => r.calls, (r) => r.outcome !== "SUCCESS"),
          byPurpose: {
            classify: sum((r) => r.calls, (r) => r.purpose === "CLASSIFY"),
            draft: sum((r) => r.calls, (r) => r.purpose === "DRAFT"),
          },
          inputTokens: sum((r) => r.inputTokens),
          outputTokens: sum((r) => r.outputTokens),
          cacheReadTokens: sum((r) => r.cacheReadTokens),
          estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
          avgLatencyMs: callRows.length
            ? Math.round(sum((r) => r.avgLatencyMs * r.calls, (r) => r.outcome === "SUCCESS") / Math.max(1, sum((r) => r.calls, (r) => r.outcome === "SUCCESS")))
            : 0,
        },
        quality: {
          aiTriaged: triage?.aiTriaged ?? 0,
          categoryOverrides: triage?.categoryOverrides ?? 0,
          priorityOverrides: triage?.priorityOverrides ?? 0,
          draftsSent: drafts?.sent ?? 0,
          draftsSentUnedited: drafts?.unedited ?? 0,
          manualReplies: manual?.count ?? 0,
        },
      });
    }),
  );

  return router;
}

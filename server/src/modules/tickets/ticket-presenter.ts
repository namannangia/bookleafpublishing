import type { Ticket } from "../../db/schema.js";
import { SLA_HOURS, UNRESOLVED_STATUSES } from "../../domain.js";

export const ticketRef = (n: number) => `BL-${n}`;

/**
 * First-response SLA. Untriaged tickets use the HIGH target so they surface
 * quickly. Once the team has replied the SLA is met.
 */
export function slaFor(ticket: Pick<Ticket, "priority" | "createdAt" | "firstResponseAt" | "status">, now: Date) {
  const hours = SLA_HOURS[ticket.priority ?? "HIGH"];
  const dueAt = new Date(ticket.createdAt.getTime() + hours * 3_600_000);
  const responded = ticket.firstResponseAt !== null;
  return {
    dueAt,
    met: responded ? ticket.firstResponseAt! <= dueAt : null,
    breached: !responded && UNRESOLVED_STATUSES.includes(ticket.status) && now > dueAt,
  };
}

import type { Response } from "express";
import type { SessionUser } from "../auth/session.js";

/**
 * Server-Sent Events fan-out.
 *
 * Events are deliberately thin ("ticket X changed"), never the data itself.
 * Clients refetch through the normal REST endpoints, so access control lives
 * in exactly one place and can't be bypassed through the event stream.
 *
 * Single-process only. With several instances this would sit behind
 * Postgres LISTEN/NOTIFY or Redis pub/sub.
 */

export type RealtimeEventType = "ticket.created" | "ticket.updated" | "ticket.message";

export interface RealtimeEvent {
  type: RealtimeEventType;
  ticketId: string;
  /** Owner of the ticket; that author receives the event unless it's admin-only. */
  authorId: string;
  /** Internal changes (notes, triage, assignment) only go to admins. */
  adminOnly?: boolean;
}

interface Subscriber {
  user: SessionUser;
  res: Response;
}

export class RealtimeHub {
  private readonly subscribers = new Set<Subscriber>();
  private heartbeat: NodeJS.Timeout | null = null;

  subscribe(user: SessionUser, res: Response): () => void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");

    const sub = { user, res };
    this.subscribers.add(sub);
    this.ensureHeartbeat();
    return () => {
      this.subscribers.delete(sub);
      if (this.subscribers.size === 0) this.stopHeartbeat();
    };
  }

  publish(event: RealtimeEvent): void {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify({ ticketId: event.ticketId })}\n\n`;
    for (const { user, res } of this.subscribers) {
      const isAdmin = user.role === "ADMIN";
      const isOwner = user.authorId === event.authorId;
      if (isAdmin || (isOwner && !event.adminOnly)) res.write(payload);
    }
  }

  get connectionCount() {
    return this.subscribers.size;
  }

  close(): void {
    this.stopHeartbeat();
    for (const { res } of this.subscribers) res.end();
    this.subscribers.clear();
  }

  // Comment lines keep idle connections open through proxies that kill silent sockets.
  private ensureHeartbeat() {
    this.heartbeat ??= setInterval(() => {
      for (const { res } of this.subscribers) res.write(": ping\n\n");
    }, 25_000);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}

import { fileSize, formatDateTime } from "../lib/format";
import type { TicketDetail } from "../lib/types";

/** The original query followed by the public conversation. Shared by author and admin views. */
export function Thread({ ticket, viewer }: { ticket: TicketDetail; viewer: "AUTHOR" | "ADMIN" }) {
  return (
    <div className="thread">
      <div className="message from-author">
        <div className="message-meta">
          <strong>{viewer === "AUTHOR" ? "You" : "Original query"}</strong> · {formatDateTime(ticket.createdAt)}
        </div>
        <div className="message-body">{ticket.description}</div>
        {ticket.attachments.length > 0 && (
          <div className="attachments">
            {ticket.attachments.map((a) => (
              <a key={a.id} href={`/api/tickets/${ticket.id}/attachments/${a.id}`} className="attachment">
                📎 {a.filename} <span className="muted">({fileSize(a.sizeBytes)})</span>
              </a>
            ))}
          </div>
        )}
      </div>
      {ticket.messages.map((m) => (
        <div key={m.id} className={`message ${m.from === "ADMIN" ? "from-team" : "from-author"}`}>
          <div className="message-meta">
            <strong>{m.from === "AUTHOR" && viewer === "AUTHOR" ? "You" : m.senderName}</strong> · {formatDateTime(m.createdAt)}
            {m.aiAssisted && (
              <span className="source source-ai" title="Sent from an AI draft">
                AI draft{m.aiDraftEdited ? " · edited" : ""}
              </span>
            )}
          </div>
          <div className="message-body">{m.body}</div>
        </div>
      ))}
    </div>
  );
}

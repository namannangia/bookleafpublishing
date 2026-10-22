import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * Subscribes to the server's SSE stream and refreshes affected queries.
 * Events only say "ticket X changed"; the data itself is refetched through
 * the normal (access-controlled) API. EventSource reconnects automatically.
 */
export function useRealtime(enabled: boolean): "connecting" | "live" | "offline" {
  const qc = useQueryClient();
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events");
    const refresh = (event: MessageEvent<string>) => {
      const { ticketId } = JSON.parse(event.data) as { ticketId: string };
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      void qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    };
    for (const type of ["ticket.created", "ticket.updated", "ticket.message"]) {
      source.addEventListener(type, refresh as EventListener);
    }
    source.onopen = () => setState("live");
    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    return () => source.close();
  }, [enabled, qc]);

  return state;
}

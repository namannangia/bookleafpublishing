import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { MulterError } from "multer";
import { AiGateway } from "./ai/ai-gateway.js";
import { DraftService } from "./ai/draft-service.js";
import type { LlmClient } from "./ai/llm.js";
import { TriageService } from "./ai/triage-service.js";
import type { Db } from "./db/client.js";
import { AppError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { adminRoutes } from "./modules/admin/admin-routes.js";
import { authRoutes } from "./modules/auth/auth-routes.js";
import { SessionSigner } from "./modules/auth/session.js";
import { bookRoutes } from "./modules/books/book-routes.js";
import { RealtimeHub } from "./modules/realtime/hub.js";
import { ticketRoutes } from "./modules/tickets/ticket-routes.js";
import { TicketService } from "./modules/tickets/ticket-service.js";

export interface AppConfig {
  jwtSecret: string;
  jwtTtlHours: number;
  secureCookies: boolean;
  classifyModel: string;
  draftModel: string;
  maxUploadBytes: number;
  /** Built SPA to serve in production; omitted in dev/tests. */
  staticDir?: string;
  now?: () => Date;
}

/** Wires services together. Kept separate from Express so tests can reach the services directly. */
export function buildServices(db: Db, llm: LlmClient | null, config: AppConfig) {
  const hub = new RealtimeHub();
  const ai = new AiGateway(db, llm);
  const triage = new TriageService(db, ai, hub, config.classifyModel);
  const drafts = new DraftService(db, ai, triage, config.draftModel, config.now);
  const tickets = new TicketService(db, hub, triage, drafts, () => ai.status());
  return { hub, ai, triage, drafts, tickets };
}
export type Services = ReturnType<typeof buildServices>;

export function createApp(db: Db, services: Services, config: AppConfig) {
  const app = express();
  const signer = new SessionSigner(config.jwtSecret, config.jwtTtlHours);
  const auth = requireAuth(signer);

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", ai: services.ai.status() });
  });

  app.use("/api/auth", authRoutes({ db, signer, requireAuth: auth, secureCookies: config.secureCookies }));

  // Everything below requires a session.
  app.use("/api", auth);
  app.get("/api/events", (req, res) => {
    const unsubscribe = services.hub.subscribe(req.user!, res);
    req.on("close", unsubscribe);
  });
  app.use("/api/books", bookRoutes({ db, now: config.now }));
  app.use(
    "/api/tickets",
    ticketRoutes({ tickets: services.tickets, drafts: services.drafts, triage: services.triage, maxUploadBytes: config.maxUploadBytes }),
  );
  app.use("/api/admin", requireRole("ADMIN"), adminRoutes({ db, aiStatus: () => services.ai.status() }));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not found." } });
  });

  if (config.staticDir && fs.existsSync(config.staticDir)) {
    const indexHtml = path.join(config.staticDir, "index.html");
    app.use(express.static(config.staticDir, { index: false, maxAge: "1h" }));
    // Client-side routing: unknown non-API paths get the SPA shell.
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(indexHtml));
  }

  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "The attachment is too large (max 5 MB)." : `Upload error: ${err.message}`;
    res.status(400).json({ error: { code: "BAD_REQUEST", message, details: { fields: { attachment: message } } } });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Request body is not valid JSON." } });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." } });
    return;
  }
  logger.error("http.unhandled_error", { method: req.method, path: req.path, error: String(err), stack: err?.stack });
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." } });
};

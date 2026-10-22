import { Router } from "express";
import multer from "multer";
import type { DraftService } from "../../ai/draft-service.js";
import type { TriageService } from "../../ai/triage-service.js";
import { badRequest } from "../../lib/errors.js";
import { handler, uuidParam } from "../../lib/http.js";
import { validate } from "../../lib/validate.js";
import { currentUser, requireRole } from "../../middleware/auth.js";
import type { TicketService } from "./ticket-service.js";
import {
  ALLOWED_ATTACHMENT_TYPES,
  AdminMessageSchema,
  AuthorMessageSchema,
  CreateTicketSchema,
  DraftRequestSchema,
  ListTicketsQuerySchema,
  NoteSchema,
  UpdateTicketSchema,
} from "./ticket-schemas.js";

export function ticketRoutes(deps: { tickets: TicketService; drafts: DraftService; triage: TriageService; maxUploadBytes: number }) {
  const { tickets, drafts, triage } = deps;
  const router = Router();
  const isAdmin = requireRole("ADMIN");

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_ATTACHMENT_TYPES.includes(file.mimetype)) cb(null, true);
      else cb(badRequest("Some fields are invalid.", { fields: { attachment: "Attach a PNG, JPEG, WebP image or a PDF." } }));
    },
  });

  /** Authors get their own tickets; admins get the filterable, paginated queue. */
  router.get(
    "/",
    handler(async (req, res) => {
      const user = currentUser(req);
      if (user.role === "AUTHOR") {
        res.json({ items: await tickets.listForAuthor(user.authorId!) });
        return;
      }
      res.json(await tickets.listForAdmin(validate(ListTicketsQuerySchema, req.query), user));
    }),
  );

  router.post(
    "/",
    requireRole("AUTHOR"),
    upload.single("attachment"),
    handler(async (req, res) => {
      const input = validate(CreateTicketSchema, req.body);
      res.status(201).json(await tickets.create(currentUser(req), input, req.file));
    }),
  );

  router.get(
    "/:id",
    handler(async (req, res) => {
      res.json(await tickets.getDetail(uuidParam(req, "id", "Ticket"), currentUser(req)));
    }),
  );

  router.patch(
    "/:id",
    isAdmin,
    handler(async (req, res) => {
      const id = uuidParam(req, "id", "Ticket");
      const user = currentUser(req);
      await tickets.update(id, user, validate(UpdateTicketSchema, req.body));
      res.json(await tickets.getDetail(id, user));
    }),
  );

  router.post(
    "/:id/messages",
    handler(async (req, res) => {
      const id = uuidParam(req, "id", "Ticket");
      const user = currentUser(req);
      const message =
        user.role === "ADMIN"
          ? await tickets.addAdminReply(id, user, validate(AdminMessageSchema, req.body))
          : await tickets.addAuthorMessage(id, user, validate(AuthorMessageSchema, req.body).body);
      res.status(201).json(message);
    }),
  );

  router.post(
    "/:id/notes",
    isAdmin,
    handler(async (req, res) => {
      const id = uuidParam(req, "id", "Ticket");
      res.status(201).json(await tickets.addNote(id, currentUser(req), validate(NoteSchema, req.body).body));
    }),
  );

  /** Returns the cached draft if still current, otherwise generates one. 503 AI_UNAVAILABLE when AI is down. */
  router.post(
    "/:id/draft",
    isAdmin,
    handler(async (req, res) => {
      const id = uuidParam(req, "id", "Ticket");
      await tickets.loadAccessible(id, currentUser(req));
      const { regenerate } = validate(DraftRequestSchema, req.body ?? {});
      res.json(await drafts.getOrGenerate(id, { regenerate }));
    }),
  );

  /** Re-runs AI triage (e.g. after an outage). Admin overrides are kept. */
  router.post(
    "/:id/triage",
    isAdmin,
    handler(async (req, res) => {
      const id = uuidParam(req, "id", "Ticket");
      const user = currentUser(req);
      await tickets.loadAccessible(id, user);
      await triage.triage(id, { force: true });
      res.json(await tickets.getDetail(id, user));
    }),
  );

  router.get(
    "/:id/attachments/:attachmentId",
    handler(async (req, res) => {
      const file = await tickets.getAttachment(
        uuidParam(req, "id", "Ticket"),
        uuidParam(req, "attachmentId", "Attachment"),
        currentUser(req),
      );
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.filename)}"`);
      res.send(file.data);
    }),
  );

  return router;
}

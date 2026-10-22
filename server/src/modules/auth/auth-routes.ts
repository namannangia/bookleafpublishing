import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { authors, users } from "../../db/schema.js";
import { unauthorized } from "../../lib/errors.js";
import { handler } from "../../lib/http.js";
import { validate } from "../../lib/validate.js";
import { currentUser } from "../../middleware/auth.js";
import { SESSION_COOKIE, type SessionSigner, type SessionUser } from "./session.js";

const LoginSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: z.string().min(1, "Password is required."),
});

// Compared against when the email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export function authRoutes(deps: { db: Db; signer: SessionSigner; requireAuth: RequestHandler; secureCookies: boolean }) {
  const { db, signer } = deps;
  const router = Router();

  // Brute-force protection: only failed attempts count toward the limit.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many login attempts. Please try again in a few minutes." } },
  });

  router.post(
    "/login",
    loginLimiter,
    handler(async (req, res) => {
      const { email, password } = validate(LoginSchema, req.body);
      const [row] = await db
        .select({ user: users, authorId: authors.id })
        .from(users)
        .leftJoin(authors, eq(authors.userId, users.id))
        .where(eq(users.email, email));

      const ok = await bcrypt.compare(password, row?.user.passwordHash ?? DUMMY_HASH);
      if (!row || !ok) throw unauthorized("Incorrect email or password.");

      const session: SessionUser = {
        id: row.user.id,
        role: row.user.role,
        name: row.user.name,
        email: row.user.email,
        authorId: row.authorId,
      };
      res.cookie(SESSION_COOKIE, await signer.sign(session), {
        httpOnly: true,
        sameSite: "lax",
        secure: deps.secureCookies,
        maxAge: signer.maxAgeMs,
        path: "/",
      });
      res.json({ user: session });
    }),
  );

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  router.get("/me", deps.requireAuth, (req, res) => {
    res.json({ user: currentUser(req) });
  });

  return router;
}

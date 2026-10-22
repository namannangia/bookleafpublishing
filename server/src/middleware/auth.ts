import type { NextFunction, Request, Response } from "express";
import type { Role } from "../domain.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { SESSION_COOKIE, type SessionSigner, type SessionUser } from "../modules/auth/session.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
  }
}

/** Rejects unauthenticated requests; attaches `req.user` otherwise. */
export function requireAuth(signer: SessionSigner) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = typeof token === "string" ? await signer.verify(token) : null;
    if (!user) return next(unauthorized());
    req.user = user;
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** For handlers mounted behind requireAuth. */
export function currentUser(req: Request): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

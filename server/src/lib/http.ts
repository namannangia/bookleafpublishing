import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { notFound } from "./errors.js";

/** Forwards async errors to the error middleware (Express 5 also does this, but explicit is clearer). */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

const Uuid = z.uuid();

/** Reads a UUID route param; malformed IDs are a 404 rather than a database error. */
export function uuidParam(req: Request, name: string, resource: string): string {
  const value = req.params[name];
  if (!Uuid.safeParse(value).success) throw notFound(resource);
  return value as string;
}

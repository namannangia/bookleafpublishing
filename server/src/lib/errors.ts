/**
 * Errors thrown anywhere in a request are mapped to a consistent JSON shape by
 * the error middleware: { error: { code, message, details? } }.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Please sign in to continue.") =>
  new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You don't have access to this resource.") =>
  new AppError(403, "FORBIDDEN", message);
export const notFound = (resource: string) => new AppError(404, "NOT_FOUND", `${resource} not found.`);
export const conflict = (message: string) => new AppError(409, "CONFLICT", message);
export const serviceUnavailable = (code: string, message: string) => new AppError(503, code, message);

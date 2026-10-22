import type { z } from "zod";
import { badRequest } from "./errors.js";

/** Parses input against a schema, turning failures into a 400 with per-field messages. */
export function validate<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    throw badRequest("Some fields are invalid.", { fields });
  }
  return result.data;
}

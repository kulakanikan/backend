import type { Context, Next } from "hono";
import { error } from "../lib/response";

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    console.error("[ERROR]", err);
    return c.json(error("INTERNAL_ERROR", "Internal server error"), 500);
  }
}

export function notFound(c: Context) {
  return c.json(
    error("NOT_FOUND", `Route ${c.req.method} ${c.req.path} not found`),
    404
  );
}

import type { Context, Next } from "hono";
import { error } from "../lib/response";

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err: any) {
    if (err && typeof err === "object" && err.code && err.message) {
      let status = 400;
      if (err.code === "INSUFFICIENT_STOCK") status = 422;
      else if (err.code === "NOT_FOUND") status = 404;
      else if (err.code === "CONFLICT") status = 409;
      return c.json(error(err.code, err.message), status);
    }
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

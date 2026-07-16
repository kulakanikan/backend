import type { Context, Next } from "hono";
import { verifyJWT } from "../services/jwt";
import { error } from "../lib/response";

export type AuthUser = {
  id: string;
  email: string;
  nama: string;
};

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(error("UNAUTHORIZED", "Missing or invalid Authorization header"), 401);
  }

  const token = authHeader.slice(7);
  let payload;
  try {
    payload = await verifyJWT(token);
  } catch (e) {
    return c.json(error("UNAUTHORIZED", "Invalid or expired token"), 401);
  }

  c.set("user", { id: payload.sub, email: payload.email, nama: payload.nama });
  await next();
}

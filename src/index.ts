import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { errorHandler, notFound } from "./middleware/error-handler";
import { success } from "./lib/response";

const app = new Hono().basePath("/api");

app.use("*", logger());
app.use("*", cors());
app.use("*", errorHandler);

app.get("/health", (c) => c.json(success({ status: "ok", timestamp: new Date().toISOString() })));

app.notFound(notFound);

export default {
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
};

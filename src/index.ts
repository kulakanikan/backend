import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { errorHandler, notFound } from "./middleware/error-handler";
import { success } from "./lib/response";
import auth from "./routes/auth";
import profile from "./routes/profile";
import suppliersRoute from "./routes/suppliers";

const app = new Hono().basePath("/api");

app.use("*", logger());
app.use("*", cors());
app.use("*", errorHandler);

app.route("/auth", auth);
app.route("/profile", profile);
app.route("/suppliers", suppliersRoute);

app.get("/health", (c) => c.json(success({ status: "ok", timestamp: new Date().toISOString() })));

app.notFound(notFound);

export { app };

export default {
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
};

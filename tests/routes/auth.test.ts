import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { app } from "../../src/index";
import { users } from "../../src/db/schema";
import { db } from "../../src/db/client";
import { eq } from "drizzle-orm";

describe("Auth Routes", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("POST /api/auth/google with invalid token should fail", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 400 }))
    ) as any;

    const res = await app.request("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: "invalid-token" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  test("GET /api/auth/me without authorization header should fail", async () => {
    const res = await app.request("/api/auth/me", {
      method: "GET",
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

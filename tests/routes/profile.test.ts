import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { signJWT } from "../../src/services/jwt";
import { eq } from "drizzle-orm";

describe("Profile Routes", () => {
  const testUserId = "11111111-1111-1111-1111-111111111111";
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";

    // Clean up if already exists
    await db.delete(users).where(eq(users.id, testUserId));

    // Insert test user
    await db.insert(users).values({
      id: testUserId,
      googleSub: "google-sub-profile-test",
      nama: "Profile Test User",
      email: "profile@example.com",
    });

    token = await signJWT({
      sub: testUserId,
      email: "profile@example.com",
      nama: "Profile Test User",
    });
  });

  afterAll(async () => {
    // Clean up
    await db.delete(users).where(eq(users.id, testUserId));
  });

  test("GET /api/profile without token should fail", async () => {
    const res = await app.request("/api/profile", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });

  test("GET /api/profile with token should succeed", async () => {
    const res = await app.request("/api/profile", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.nama_google).toBe("Profile Test User");
    expect(body.data.nama_usaha).toBeNull();
  });

  test("PATCH /api/profile with empty body should fail validation", async () => {
    const res = await app.request("/api/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("PATCH /api/profile with valid body should succeed and update profile", async () => {
    const res = await app.request("/api/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nama_usaha: "UD Mina Jaya",
        telepon_usaha: "081234567890",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.nama_usaha).toBe("UD Mina Jaya");
    expect(body.data.telepon_usaha).toBe("081234567890");

    // Fetch again to verify persistence
    const getRes = await app.request("/api/profile", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const getBody = await getRes.json();
    expect(getBody.data.nama_usaha).toBe("UD Mina Jaya");
    expect(getBody.data.telepon_usaha).toBe("081234567890");
  });
});

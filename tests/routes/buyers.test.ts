import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/db/client";
import { users, buyers } from "../../src/db/schema";
import { signJWT } from "../../src/services/jwt";
import { eq, inArray } from "drizzle-orm";

describe("Buyers CRUD Routes", () => {
  const testUserId1 = "22222222-2222-2222-2222-222222222222";
  const testUserId2 = "33333333-3333-3333-3333-333333333333";
  let tokenUser1: string;
  let tokenUser2: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";

    // Clean up
    await db.delete(buyers).where(inArray(buyers.userId, [testUserId1, testUserId2]));
    await db.delete(users).where(inArray(users.id, [testUserId1, testUserId2]));

    // Insert two users
    await db.insert(users).values([
      { id: testUserId1, googleSub: "google-sub-buyer-test-1", nama: "User One", email: "user1@example.com" },
      { id: testUserId2, googleSub: "google-sub-buyer-test-2", nama: "User Two", email: "user2@example.com" },
    ]);

    tokenUser1 = await signJWT({ sub: testUserId1, email: "user1@example.com", nama: "User One" });
    tokenUser2 = await signJWT({ sub: testUserId2, email: "user2@example.com", nama: "User Two" });
  });

  afterAll(async () => {
    // Clean up
    await db.delete(buyers).where(inArray(buyers.userId, [testUserId1, testUserId2]));
    await db.delete(users).where(inArray(users.id, [testUserId1, testUserId2]));
  });

  test("GET /api/buyers initially returns empty list", async () => {
    const res = await app.request("/api/buyers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.buyers).toEqual([]);
  });

  test("POST /api/buyers adds buyer with all fields successfully", async () => {
    const res = await app.request("/api/buyers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nama: "RM Sederhana",
        telepon: "0812345678",
        tipe_pembeli: "restoran",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.buyer.nama).toBe("RM Sederhana");
    expect(body.data.buyer.telepon).toBe("0812345678");
    expect(body.data.buyer.tipePembeli).toBe("restoran");
    expect(body.data.buyer.userId).toBe(testUserId1);
  });

  test("POST /api/buyers adds buyer with only nama successfully", async () => {
    const res = await app.request("/api/buyers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nama: "Bu Dewi",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.buyer.nama).toBe("Bu Dewi");
    expect(body.data.buyer.telepon).toBeNull();
    expect(body.data.buyer.tipePembeli).toBeNull();
  });

  test("POST /api/buyers with empty nama fails validation", async () => {
    const res = await app.request("/api/buyers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nama: "",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("Multi-tenant: GET /api/buyers shows only owned buyers sorted by name ascending", async () => {
    // User 2 adds a buyer
    await app.request("/api/buyers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nama: "Pak Dahlan" }),
    });

    // GET for User 1
    const res1 = await app.request("/api/buyers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.success).toBe(true);
    expect(body1.data.buyers.length).toBe(2);
    // RM Sederhana and Bu Dewi should be returned sorted alphabetically
    // B comes before R
    expect(body1.data.buyers[0].nama).toBe("Bu Dewi");
    expect(body1.data.buyers[1].nama).toBe("RM Sederhana");
  });

  test("GET /api/buyers/:id returns details", async () => {
    const listRes = await app.request("/api/buyers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const listBody = await listRes.json();
    const buyerId = listBody.data.buyers[0].id;

    const res = await app.request(`/api/buyers/${buyerId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.buyer.id).toBe(buyerId);
  });

  test("Multi-tenant: GET /api/buyers/:id for another user's buyer returns 404", async () => {
    // Get User 2's buyer
    const listRes2 = await app.request("/api/buyers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser2}` },
    });
    const listBody2 = await listRes2.json();
    const buyerId2 = listBody2.data.buyers[0].id;

    const res = await app.request(`/api/buyers/${buyerId2}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(404);
  });

  test("PATCH /api/buyers/:id updates successfully", async () => {
    const listRes = await app.request("/api/buyers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const listBody = await listRes.json();
    const buyerId = listBody.data.buyers[0].id;

    const res = await app.request(`/api/buyers/${buyerId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        telepon: "0899999999",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.buyer.telepon).toBe("0899999999");
  });

  test("Multi-tenant: PATCH /api/buyers/:id for another user's buyer returns 404", async () => {
    const listRes2 = await app.request("/api/buyers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser2}` },
    });
    const listBody2 = await listRes2.json();
    const buyerId2 = listBody2.data.buyers[0].id;

    const res = await app.request(`/api/buyers/${buyerId2}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        telepon: "0899999999",
      }),
    });
    expect(res.status).toBe(404);
  });
});

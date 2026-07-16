import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/db/client";
import { users, suppliers, batches } from "../../src/db/schema";
import { signJWT } from "../../src/services/jwt";
import { eq, inArray } from "drizzle-orm";

describe("Suppliers CRUD Routes", () => {
  const testUserId1 = "22222222-2222-2222-2222-222222222222";
  const testUserId2 = "33333333-3333-3333-3333-333333333333";
  let tokenUser1: string;
  let tokenUser2: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";

    // Clean up
    await db.delete(batches).where(inArray(batches.userId, [testUserId1, testUserId2]));
    await db.delete(suppliers).where(inArray(suppliers.userId, [testUserId1, testUserId2]));
    await db.delete(users).where(inArray(users.id, [testUserId1, testUserId2]));

    // Insert two users
    await db.insert(users).values([
      { id: testUserId1, googleSub: "google-sub-supplier-test-1", nama: "User One", email: "user1@example.com" },
      { id: testUserId2, googleSub: "google-sub-supplier-test-2", nama: "User Two", email: "user2@example.com" },
    ]);

    tokenUser1 = await signJWT({ sub: testUserId1, email: "user1@example.com", nama: "User One" });
    tokenUser2 = await signJWT({ sub: testUserId2, email: "user2@example.com", nama: "User Two" });
  });

  afterAll(async () => {
    // Clean up
    await db.delete(batches).where(inArray(batches.userId, [testUserId1, testUserId2]));
    await db.delete(suppliers).where(inArray(suppliers.userId, [testUserId1, testUserId2]));
    await db.delete(users).where(inArray(users.id, [testUserId1, testUserId2]));
  });

  test("GET /api/suppliers initially returns empty list", async () => {
    const res = await app.request("/api/suppliers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.suppliers).toEqual([]);
  });

  test("POST /api/suppliers adds supplier successfully", async () => {
    const res = await app.request("/api/suppliers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nama_nelayan: "Pak Slamet",
        telepon: "08123456789",
        alamat: "Pelabuhan Ratu",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.supplier.namaNelayan).toBe("Pak Slamet");
    expect(body.data.supplier.userId).toBe(testUserId1);
  });

  test("POST /api/suppliers with missing nama_nelayan fails validation", async () => {
    const res = await app.request("/api/suppliers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        telepon: "08123456789",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("Multi-tenant: GET /api/suppliers shows only owned suppliers", async () => {
    // User 2 adds a supplier
    await app.request("/api/suppliers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nama_nelayan: "Pak Dahlan" }),
    });

    // GET for User 1
    const res1 = await app.request("/api/suppliers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const body1 = await res1.json();
    expect(body1.data.suppliers.length).toBe(1);
    expect(body1.data.suppliers[0].namaNelayan).toBe("Pak Slamet");

    // GET for User 2
    const res2 = await app.request("/api/suppliers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser2}` },
    });
    const body2 = await res2.json();
    expect(body2.data.suppliers.length).toBe(1);
    expect(body2.data.suppliers[0].namaNelayan).toBe("Pak Dahlan");
  });

  test("GET /api/suppliers/:id returns detail", async () => {
    // Get User 1's supplier ID
    const listRes = await app.request("/api/suppliers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const list = await listRes.json();
    const supplierId = list.data.suppliers[0].id;

    const res = await app.request(`/api/suppliers/${supplierId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.supplier.namaNelayan).toBe("Pak Slamet");
  });

  test("Multi-tenant: GET /api/suppliers/:id for another user's supplier returns 404", async () => {
    // Get User 2's supplier ID
    const listRes = await app.request("/api/suppliers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser2}` },
    });
    const list = await listRes.json();
    const supplierId = list.data.suppliers[0].id;

    const res = await app.request(`/api/suppliers/${supplierId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` }, // User 1 tries to access User 2's supplier
    });
    expect(res.status).toBe(404);
  });

  test("PATCH /api/suppliers/:id updates successfully", async () => {
    const listRes = await app.request("/api/suppliers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const list = await listRes.json();
    const supplierId = list.data.suppliers[0].id;

    const res = await app.request(`/api/suppliers/${supplierId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nama_nelayan: "Pak Slamet Update",
        telepon: "08999999",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.supplier.namaNelayan).toBe("Pak Slamet Update");
    expect(body.data.supplier.telepon).toBe("08999999");
  });

  test("DELETE /api/suppliers/:id returns 409 Conflict if supplier has active batches", async () => {
    const listRes = await app.request("/api/suppliers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const list = await listRes.json();
    const supplierId = list.data.suppliers[0].id;

    // Create a batch linked to this supplier
    await db.insert(batches).values({
      userId: testUserId1,
      supplierId: supplierId,
      jenisIkan: "Tongkol",
      berat: "50.00",
      hargaBeliPerKg: "25000",
      sumberInput: "manual",
      status: "aktif",
      diterimaAt: new Date(),
    });

    const res = await app.request(`/api/suppliers/${supplierId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("CONFLICT");

    // Clean up the test batch so we can delete the supplier in the next test
    await db.delete(batches).where(eq(batches.supplierId, supplierId));
  });

  test("DELETE /api/suppliers/:id deletes successfully if no batches", async () => {
    const listRes = await app.request("/api/suppliers", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const list = await listRes.json();
    const supplierId = list.data.suppliers[0].id;

    const res = await app.request(`/api/suppliers/${supplierId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(204);

    // Verify it is gone
    const checkRes = await app.request(`/api/suppliers/${supplierId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(checkRes.status).toBe(404);
  });
});

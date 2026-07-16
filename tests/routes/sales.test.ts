import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/db/client";
import { users, suppliers, batches, buyers, sales, saleExtras, receipts } from "../../src/db/schema";
import { signJWT } from "../../src/services/jwt";
import { eq, inArray } from "drizzle-orm";

describe("Sales CRUD & Transaction Routes", () => {
  const testUserId1 = "22222222-2222-2222-2222-222222222222";
  const testUserId2 = "33333333-3333-3333-3333-333333333333";
  let tokenUser1: string;
  let tokenUser2: string;

  let supplierId1: string;
  let buyerId1: string;
  let batchId1: string;

  let supplierId2: string;
  let buyerId2: string;
  let batchId2: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";

    // Clean up
    await db.delete(receipts);
    await db.delete(saleExtras);
    await db.delete(sales);
    await db.delete(batches).where(inArray(batches.userId, [testUserId1, testUserId2]));
    await db.delete(suppliers).where(inArray(suppliers.userId, [testUserId1, testUserId2]));
    await db.delete(buyers).where(inArray(buyers.userId, [testUserId1, testUserId2]));
    await db.delete(users).where(inArray(users.id, [testUserId1, testUserId2]));

    // Insert two users
    await db.insert(users).values([
      { id: testUserId1, googleSub: "google-sub-sales-test-1", nama: "User One", email: "user1@example.com" },
      { id: testUserId2, googleSub: "google-sub-sales-test-2", nama: "User Two", email: "user2@example.com" },
    ]);

    tokenUser1 = await signJWT({ sub: testUserId1, email: "user1@example.com", nama: "User One" });
    tokenUser2 = await signJWT({ sub: testUserId2, email: "user2@example.com", nama: "User Two" });

    // Seed Suppliers
    const [s1] = await db.insert(suppliers).values({
      userId: testUserId1,
      namaNelayan: "Supplier One",
    }).returning();
    supplierId1 = s1.id;

    const [s2] = await db.insert(suppliers).values({
      userId: testUserId2,
      namaNelayan: "Supplier Two",
    }).returning();
    supplierId2 = s2.id;

    // Seed Buyers
    const [b1] = await db.insert(buyers).values({
      userId: testUserId1,
      nama: "Buyer One",
    }).returning();
    buyerId1 = b1.id;

    const [b2] = await db.insert(buyers).values({
      userId: testUserId2,
      nama: "Buyer Two",
    }).returning();
    buyerId2 = b2.id;

    // Seed Batches
    const [ba1] = await db.insert(batches).values({
      userId: testUserId1,
      supplierId: supplierId1,
      jenisIkan: "Tongkol",
      berat: "50.00",
      hargaBeliPerKg: "20000",
      sumberInput: "manual",
      diterimaAt: new Date(),
    }).returning();
    batchId1 = ba1.id;

    const [ba2] = await db.insert(batches).values({
      userId: testUserId2,
      supplierId: supplierId2,
      jenisIkan: "Lele",
      berat: "30.00",
      hargaBeliPerKg: "15000",
      sumberInput: "manual",
      diterimaAt: new Date(),
    }).returning();
    batchId2 = ba2.id;
  });

  afterAll(async () => {
    // Clean up
    await db.delete(receipts);
    await db.delete(saleExtras);
    await db.delete(sales);
    await db.delete(batches).where(inArray(batches.userId, [testUserId1, testUserId2]));
    await db.delete(suppliers).where(inArray(suppliers.userId, [testUserId1, testUserId2]));
    await db.delete(buyers).where(inArray(buyers.userId, [testUserId1, testUserId2]));
    await db.delete(users).where(inArray(users.id, [testUserId1, testUserId2]));
  });

  test("GET /api/sales initially returns empty list", async () => {
    const res = await app.request("/api/sales", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.sales).toEqual([]);
  });

  test("POST /api/sales adds sale successfully with extras & reduces batch weight", async () => {
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_id: batchId1,
        buyer_id: buyerId1,
        berat_jual: 10,
        harga_satuan: 30000,
        status_bayar: "lunas",
        tanggal: new Date().toISOString(),
        extras: [
          { nama_item: "Es Batu", jumlah: 2, harga_satuan: 5000 }
        ]
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.sale.total).toBe("310000.00"); // 10 * 30000 + 2 * 5000 = 310000
    expect(body.data.extras.length).toBe(1);
    expect(body.data.extras[0].namaItem).toBe("Es Batu");
    expect(body.data.receipt.nomorStruk).toMatch(/^STR-\d{8}-[A-Z0-9]{6}$/);

    // Verify batch weight reduced
    const batchRes = await app.request(`/api/batches/${batchId1}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const batchBody = await batchRes.json();
    expect(Number(batchBody.data.batch.berat)).toBe(40.00); // 50 - 10 = 40
  });

  test("POST /api/sales fails if stock is insufficient", async () => {
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_id: batchId1,
        buyer_id: buyerId1,
        berat_jual: 45, // stock is 40
        harga_satuan: 30000,
        status_bayar: "lunas",
        tanggal: new Date().toISOString(),
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  test("Multi-tenant: POST /api/sales fails if batch does not belong to user", async () => {
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_id: batchId2, // User 2's batch
        buyer_id: buyerId1,
        berat_jual: 5,
        harga_satuan: 30000,
        status_bayar: "lunas",
        tanggal: new Date().toISOString(),
      }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("BATCH_NOT_FOUND");
  });

  test("Multi-tenant: POST /api/sales fails if buyer does not belong to user", async () => {
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_id: batchId1,
        buyer_id: buyerId2, // User 2's buyer
        berat_jual: 5,
        harga_satuan: 30000,
        status_bayar: "lunas",
        tanggal: new Date().toISOString(),
      }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("BUYER_NOT_FOUND");
  });

  test("GET /api/sales returns only user's sales", async () => {
    // User 2 adds a sale
    const res2 = await app.request("/api/sales", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_id: batchId2,
        buyer_id: buyerId2,
        berat_jual: 5,
        harga_satuan: 20000,
        status_bayar: "tempo",
        tanggal: new Date().toISOString(),
      }),
    });
    expect(res2.status).toBe(201);

    // GET for User 1
    const res1 = await app.request("/api/sales", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.success).toBe(true);
    expect(body1.data.sales.length).toBe(1);
    expect(body1.data.sales[0].batch.jenisIkan).toBe("Tongkol");
  });

  test("GET /api/sales/:id returns details successfully", async () => {
    const listRes = await app.request("/api/sales", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const listBody = await listRes.json();
    const saleId = listBody.data.sales[0].id;

    const res = await app.request(`/api/sales/${saleId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.sale.id).toBe(saleId);
    expect(body.data.sale.extras.length).toBe(1);
    expect(body.data.sale.receipt).toBeDefined();
    expect(body.data.sale.buyer.nama).toBe("Buyer One");
  });

  test("Multi-tenant: GET /api/sales/:id for another user's sale returns 404", async () => {
    const listRes2 = await app.request("/api/sales", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser2}` },
    });
    const listBody2 = await listRes2.json();
    const saleId2 = listBody2.data.sales[0].id;

    const res = await app.request(`/api/sales/${saleId2}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(404);
  });
});

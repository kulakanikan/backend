import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/db/client";
import { users, suppliers, batches, buyers, sales, payments, receipts, saleExtras } from "../../src/db/schema";
import { signJWT } from "../../src/services/jwt";
import { eq, inArray } from "drizzle-orm";

describe("Payments / Debt Installments Routes", () => {
  const testUserId1 = "22222222-2222-2222-2222-222222222222";
  const testUserId2 = "33333333-3333-3333-3333-333333333333";
  let tokenUser1: string;
  let tokenUser2: string;

  let supplierId1: string;
  let buyerId1: string;
  let batchId1: string;
  let saleId1: string; // User 1's tempo sale

  let supplierId2: string;
  let buyerId2: string;
  let batchId2: string;
  let saleId2: string; // User 2's tempo sale

  beforeAll(async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";

    // Clean up
    await db.delete(payments);
    await db.delete(receipts);
    await db.delete(saleExtras);
    await db.delete(sales);
    await db.delete(batches).where(inArray(batches.userId, [testUserId1, testUserId2]));
    await db.delete(suppliers).where(inArray(suppliers.userId, [testUserId1, testUserId2]));
    await db.delete(buyers).where(inArray(buyers.userId, [testUserId1, testUserId2]));
    await db.delete(users).where(inArray(users.id, [testUserId1, testUserId2]));

    // Insert two users
    await db.insert(users).values([
      { id: testUserId1, googleSub: "google-sub-payments-test-1", nama: "User One", email: "user1@example.com" },
      { id: testUserId2, googleSub: "google-sub-payments-test-2", nama: "User Two", email: "user2@example.com" },
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
      berat: "100.00",
      hargaBeliPerKg: "20000",
      sumberInput: "manual",
      diterimaAt: new Date(),
    }).returning();
    batchId1 = ba1.id;

    const [ba2] = await db.insert(batches).values({
      userId: testUserId2,
      supplierId: supplierId2,
      jenisIkan: "Lele",
      berat: "100.00",
      hargaBeliPerKg: "15000",
      sumberInput: "manual",
      diterimaAt: new Date(),
    }).returning();
    batchId2 = ba2.id;

    // Seed Sales (tempo, total = 300000)
    const [sa1] = await db.insert(sales).values({
      batchId: batchId1,
      buyerId: buyerId1,
      beratJual: "10.00",
      hargaSatuan: "30000",
      total: "300000.00",
      statusBayar: "tempo",
      tanggal: new Date(),
    }).returning();
    saleId1 = sa1.id;

    const [sa2] = await db.insert(sales).values({
      batchId: batchId2,
      buyerId: buyerId2,
      beratJual: "10.00",
      hargaSatuan: "30000",
      total: "300000.00",
      statusBayar: "tempo",
      tanggal: new Date(),
    }).returning();
    saleId2 = sa2.id;
  });

  afterAll(async () => {
    // Clean up
    await db.delete(payments);
    await db.delete(receipts);
    await db.delete(saleExtras);
    await db.delete(sales);
    await db.delete(batches).where(inArray(batches.userId, [testUserId1, testUserId2]));
    await db.delete(suppliers).where(inArray(suppliers.userId, [testUserId1, testUserId2]));
    await db.delete(buyers).where(inArray(buyers.userId, [testUserId1, testUserId2]));
    await db.delete(users).where(inArray(users.id, [testUserId1, testUserId2]));
  });

  test("GET /api/sales/:id/payments initially returns empty list", async () => {
    const res = await app.request(`/api/sales/${saleId1}/payments`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.payments).toEqual([]);
  });

  test("POST /api/sales/:id/payments records partial payment successfully", async () => {
    const res = await app.request(`/api/sales/${saleId1}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jumlah_bayar: 100000,
        metode_bayar: "transfer",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.payment.jumlahBayar).toBe("100000.00");
    expect(body.data.sale_status_updated).toBe(false);
    expect(body.data.total_paid).toBe(100000);
    expect(body.data.remaining).toBe(200000);

    // Verify sale status remains "tempo"
    const saleRes = await app.request(`/api/sales/${saleId1}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const saleBody = await saleRes.json();
    expect(saleBody.data.sale.statusBayar).toBe("tempo");
  });

  test("POST /api/sales/:id/payments records final payment and updates sale status to lunas", async () => {
    const res = await app.request(`/api/sales/${saleId1}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jumlah_bayar: 200000,
        metode_bayar: "cash",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.sale_status_updated).toBe(true);
    expect(body.data.total_paid).toBe(300000);
    expect(body.data.remaining).toBe(0);

    // Verify sale status updated to "lunas"
    const saleRes = await app.request(`/api/sales/${saleId1}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const saleBody = await saleRes.json();
    expect(saleBody.data.sale.statusBayar).toBe("lunas");
  });

  test("POST /api/sales/:id/payments to an already lunas sale returns 409 Conflict", async () => {
    const res = await app.request(`/api/sales/${saleId1}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jumlah_bayar: 50000,
        metode_bayar: "cash",
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
  });

  test("Multi-tenant: GET /api/sales/:id/payments for another user's sale returns 404", async () => {
    const res = await app.request(`/api/sales/${saleId2}/payments`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(404);
  });

  test("Multi-tenant: POST /api/sales/:id/payments for another user's sale returns 404", async () => {
    const res = await app.request(`/api/sales/${saleId2}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jumlah_bayar: 50000,
        metode_bayar: "cash",
      }),
    });
    expect(res.status).toBe(404);
  });

  test("GET /api/sales/:id/payments lists payments ordered by dibayarAt ascending", async () => {
    const res = await app.request(`/api/sales/${saleId1}/payments`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.payments.length).toBe(2);
    // 100000 is first, then 200000
    expect(body.data.payments[0].jumlahBayar).toBe("100000.00");
    expect(body.data.payments[1].jumlahBayar).toBe("200000.00");
  });
});

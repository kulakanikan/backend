import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/db/client";
import { users, suppliers, batches, buyers, sales, payments, receipts, saleExtras } from "../../src/db/schema";
import { signJWT } from "../../src/services/jwt";
import { eq, inArray } from "drizzle-orm";

describe("Dashboard & Reports Routes", () => {
  const testUserId1 = "22222222-2222-2222-2222-222222222222";
  let tokenUser1: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";

    // Clean up
    await db.delete(payments);
    await db.delete(receipts);
    await db.delete(saleExtras);
    await db.delete(sales);
    await db.delete(batches).where(eq(batches.userId, testUserId1));
    await db.delete(suppliers).where(eq(suppliers.userId, testUserId1));
    await db.delete(buyers).where(eq(buyers.userId, testUserId1));
    await db.delete(users).where(eq(users.id, testUserId1));

    // Insert user
    await db.insert(users).values({
      id: testUserId1,
      googleSub: "google-sub-dashboard-test-1",
      nama: "User One",
      email: "user1@example.com",
    });

    tokenUser1 = await signJWT({ sub: testUserId1, email: "user1@example.com", nama: "User One" });

    // Seed Suppliers
    const [s1] = await db.insert(suppliers).values({
      userId: testUserId1,
      namaNelayan: "Supplier One",
    }).returning();

    // Seed Buyers
    const [b1] = await db.insert(buyers).values({
      userId: testUserId1,
      nama: "Buyer One",
    }).returning();

    // Seed Batches
    const [ba1] = await db.insert(batches).values({
      userId: testUserId1,
      supplierId: s1.id,
      jenisIkan: "Tongkol",
      berat: "50.00",
      hargaBeliPerKg: "20000",
      sumberInput: "manual",
      diterimaAt: new Date(),
    }).returning();

    // Seed Sales (total = 300000)
    const [sa1] = await db.insert(sales).values({
      batchId: ba1.id,
      buyerId: b1.id,
      beratJual: "10.00",
      hargaSatuan: "30000",
      total: "300000.00",
      statusBayar: "tempo",
      tanggal: new Date(),
    }).returning();

    await db.insert(receipts).values({
      saleId: sa1.id,
      nomorStruk: "STR-20260716-999999",
    });
  });

  afterAll(async () => {
    // Clean up
    await db.delete(payments);
    await db.delete(receipts);
    await db.delete(saleExtras);
    await db.delete(sales);
    await db.delete(batches).where(eq(batches.userId, testUserId1));
    await db.delete(suppliers).where(eq(suppliers.userId, testUserId1));
    await db.delete(buyers).where(eq(buyers.userId, testUserId1));
    await db.delete(users).where(eq(users.id, testUserId1));
  });

  test("GET /api/dashboard/summary returns correct summary statistics", async () => {
    const res = await app.request("/api/dashboard/summary", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.omzet).toBe(300000);
    expect(body.data.stok_tersisa_kg).toBe(50.00); // batch is still active, weight is 50.00
    expect(body.data.total_piutang).toBe(300000); // 300000 unpaid tempo sale
    expect(body.data.top_batch.length).toBe(1);
    expect(body.data.top_batch[0].jenis_ikan).toBe("Tongkol");
  });

  test("GET /api/dashboard/waste-insight returns insights array", async () => {
    const res = await app.request("/api/dashboard/waste-insight", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.insights)).toBe(true);
  });

  test("GET /api/reports/financial returns correct transaction reports within dates", async () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setHours(23, 59, 59, 999);

    const res = await app.request(`/api/reports/financial?from=${from.toISOString()}&to=${to.toISOString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.ringkasan.omzet).toBe(300000);
    expect(body.data.transaksi.length).toBe(1);
    expect(body.data.transaksi[0].jenis_ikan).toBe("Tongkol");
  });

  test("GET /api/reports/financial with invalid dates returns 400 validation error", async () => {
    const res = await app.request(`/api/reports/financial?from=invalid&to=invalid`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/reports/financial with from > to returns 400 validation error", async () => {
    const from = new Date();
    from.setDate(from.getDate() + 1);
    const to = new Date();

    const res = await app.request(`/api/reports/financial?from=${from.toISOString()}&to=${to.toISOString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(400);
  });
});

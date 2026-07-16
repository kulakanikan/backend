import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/db/client";
import { users, suppliers, batches, buyers, sales, saleExtras, receipts } from "../../src/db/schema";
import { signJWT } from "../../src/services/jwt";
import { eq, inArray } from "drizzle-orm";

describe("Receipts / Digital Receipt Routes", () => {
  const testUserId1 = "22222222-2222-2222-2222-222222222222";
  const testUserId2 = "33333333-3333-3333-3333-333333333333";
  let tokenUser1: string;
  let tokenUser2: string;

  let supplierId1: string;
  let buyerId1: string;
  let batchId1: string;
  let saleId1: string;
  let receiptId1: string; // User 1's receipt

  let supplierId2: string;
  let buyerId2: string;
  let batchId2: string;
  let saleId2: string;
  let receiptId2: string; // User 2's receipt

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
      { id: testUserId1, googleSub: "google-sub-receipts-test-1", nama: "User One", email: "user1@example.com", namaUsaha: "Distributor Satu", teleponUsaha: "081111111" },
      { id: testUserId2, googleSub: "google-sub-receipts-test-2", nama: "User Two", email: "user2@example.com", namaUsaha: "Distributor Dua", teleponUsaha: "082222222" },
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
      telepon: "081234567890",
    }).returning();
    buyerId1 = b1.id;

    const [b2] = await db.insert(buyers).values({
      userId: testUserId2,
      nama: "Buyer Two",
      telepon: "089876543210",
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

    // Seed Receipts
    const [re1] = await db.insert(receipts).values({
      saleId: saleId1,
      nomorStruk: "STR-20260716-111111",
      statusKirimWa: "belum_dikirim",
    }).returning();
    receiptId1 = re1.id;

    const [re2] = await db.insert(receipts).values({
      saleId: saleId2,
      nomorStruk: "STR-20260716-222222",
      statusKirimWa: "belum_dikirim",
    }).returning();
    receiptId2 = re2.id;
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

  test("GET /api/receipts/:id returns full receipt details successfully", async () => {
    const res = await app.request(`/api/receipts/${receiptId1}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.receipt.nomor_struk).toBe("STR-20260716-111111");
    expect(Number(body.data.sale.total)).toBe(300000);
    expect(body.data.buyer.nama).toBe("Buyer One");
    expect(body.data.batch.jenis_ikan).toBe("Tongkol");
    expect(body.data.penjual.nama_usaha).toBe("Distributor Satu");
  });

  test("Multi-tenant: GET /api/receipts/:id for another user's receipt returns 404", async () => {
    const res = await app.request(`/api/receipts/${receiptId2}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/receipts/:id/send-wa generates wa.me link & updates status to terkirim", async () => {
    const res = await app.request(`/api/receipts/${receiptId1}/send-wa`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone_number: "081234567890",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.wa_link).toContain("https://wa.me/6281234567890?text=");

    // Verify status updated in DB
    const receiptRes = await app.request(`/api/receipts/${receiptId1}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const receiptBody = await receiptRes.json();
    expect(receiptBody.data.receipt.status_kirim_wa).toBe("terkirim");
  });

  test("Multi-tenant: POST /api/receipts/:id/send-wa for another user's receipt returns 404", async () => {
    const res = await app.request(`/api/receipts/${receiptId2}/send-wa`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone_number: "081234567890",
      }),
    });
    expect(res.status).toBe(404);
  });
});

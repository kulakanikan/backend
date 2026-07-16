import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/db/client";
import { users, suppliers, batches, batchExpenses, sales } from "../../src/db/schema";
import { signJWT } from "../../src/services/jwt";
import { eq, inArray } from "drizzle-orm";

describe("Batches & Expenses Routes", () => {
  const testUserId = "44444444-4444-4444-4444-444444444444";
  let token: string;
  let supplierId: string;
  let batchId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";

    // Clean up
    await db.delete(batchExpenses).where(
      inArray(
        batchExpenses.batchId,
        db.select({ id: batches.id }).from(batches).where(eq(batches.userId, testUserId))
      )
    );
    await db.delete(batches).where(eq(batches.userId, testUserId));
    await db.delete(suppliers).where(eq(suppliers.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));

    // Insert user
    await db.insert(users).values({
      id: testUserId,
      googleSub: "google-sub-batches-test",
      nama: "Batches Test User",
      email: "batches@example.com",
    });

    token = await signJWT({
      sub: testUserId,
      email: "batches@example.com",
      nama: "Batches Test User",
    });

    // Insert a supplier
    const [supplier] = await db.insert(suppliers).values({
      userId: testUserId,
      namaNelayan: "Nelayan Test Batches",
    }).returning();
    supplierId = supplier.id;
  });

  afterAll(async () => {
    // Clean up
    await db.delete(batchExpenses).where(
      inArray(
        batchExpenses.batchId,
        db.select({ id: batches.id }).from(batches).where(eq(batches.userId, testUserId))
      )
    );
    await db.delete(batches).where(eq(batches.userId, testUserId));
    await db.delete(suppliers).where(eq(suppliers.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  test("GET /api/batches initially returns empty", async () => {
    const res = await app.request("/api/batches", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.batches).toEqual([]);
  });

  test("POST /api/batches adds batch successfully", async () => {
    const res = await app.request("/api/batches", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        jenis_ikan: "Kerapu",
        berat: 100.5,
        harga_beli_per_kg: 50000,
        kondisi_kualitas: "segar",
        sumber_input: "manual",
        diterima_at: "2026-07-16T12:00:00.000Z",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.batch.jenisIkan).toBe("Kerapu");
    expect(body.data.batch.berat).toBe("100.50");
    expect(body.data.batch.status).toBe("aktif");
    batchId = body.data.batch.id;
  });

  test("GET /api/batches/:id returns details with suppliers and expenses", async () => {
    const res = await app.request(`/api/batches/${batchId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.batch.suppliers.namaNelayan).toBe("Nelayan Test Batches");
    expect(body.data.batch.expenses).toEqual([]);
  });

  test("PATCH /api/batches/:id updates general fields", async () => {
    const res = await app.request(`/api/batches/${batchId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kondisi_kualitas: "kurang segar",
        status: "aktif",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.batch.kondisiKualitas).toBe("kurang segar");
  });

  test("POST /api/batches/:id/susut decreases weight and creates expense", async () => {
    const res = await app.request(`/api/batches/${batchId}/susut`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        berat_susut: 10.5,
        catatan: "10.5 kg rusak busuk",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.batch.berat).toBe("90.00"); // 100.5 - 10.5
    expect(body.data.expense.jenisBiaya).toBe("Susut/Rusak");
    // kerugian = 10.5 * 50000 = 525000
    expect(body.data.expense.jumlah).toBe("525000.00");
  });

  test("POST /api/batches/:id/susut fails with 422 if weight exceeds stock", async () => {
    const res = await app.request(`/api/batches/${batchId}/susut`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        berat_susut: 999.0,
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  test("POST /api/batches/:id/expenses adds batch expense", async () => {
    const res = await app.request(`/api/batches/${batchId}/expenses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jenis_biaya: "Transportasi",
        jumlah: 150000,
        catatan: "Bensin kurir",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.expense.jenisBiaya).toBe("Transportasi");
    expect(body.data.expense.jumlah).toBe("150000.00");
  });

  test("GET /api/batches/:id/expenses retrieves all expenses", async () => {
    const res = await app.request(`/api/batches/${batchId}/expenses`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.expenses.length).toBe(2); // Susut/Rusak + Transportasi
  });

  test("DELETE /api/batch-expenses/:id deletes expense successfully", async () => {
    // Get list of expenses
    const listRes = await app.request(`/api/batches/${batchId}/expenses`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json();
    const transportExpenseId = listBody.data.expenses.find(
      (e: any) => e.jenisBiaya === "Transportasi"
    ).id;

    const res = await app.request(`/api/batch-expenses/${transportExpenseId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);

    // Verify deleted
    const checkRes = await app.request(`/api/batches/${batchId}/expenses`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const checkBody = await checkRes.json();
    expect(checkBody.data.expenses.length).toBe(1); // Only Susut/Rusak remains
  });

  test("DELETE /api/batches/:id deletes batch and linked expenses", async () => {
    const res = await app.request(`/api/batches/${batchId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);

    // Verify batch is gone
    const checkRes = await app.request(`/api/batches/${batchId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(checkRes.status).toBe(404);
  });
});

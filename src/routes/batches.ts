import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, count, asc, desc } from "drizzle-orm";
import { db } from "../db/client";
import { batches, batchExpenses, sales } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";

const batchesRoute = new Hono();

batchesRoute.use("*", authMiddleware);

// GET /batches — list batch dengan filter opsional, default FIFO
batchesRoute.get("/", async (c) => {
  const { id: userId } = c.get("user");
  const { status, supplier_id, jenis_ikan, order } = c.req.query();

  const result = await db.query.batches.findMany({
    where: (b, { and: andFn, eq: eqFn }) => {
      const conditions = [eqFn(b.userId, userId)];
      if (status) conditions.push(eqFn(b.status, status as "aktif" | "habis"));
      if (supplier_id) conditions.push(eqFn(b.supplierId, supplier_id));
      if (jenis_ikan) conditions.push(eqFn(b.jenisIkan, jenis_ikan));
      return andFn(...conditions);
    },
    orderBy: order === "desc"
      ? (b, { desc }) => [desc(b.diterimaAt)]
      : (b, { asc }) => [asc(b.diterimaAt)], // default FIFO
    with: {
      suppliers: { columns: { namaNelayan: true, telepon: true } },
      batchExpenses: true,
    },
  });

  return c.json(success({ batches: result }));
});

// POST /batches — buat batch baru (manual input)
batchesRoute.post(
  "/",
  zValidator(
    "json",
    z.object({
      supplier_id: z.string().uuid(),
      jenis_ikan: z.string().min(1).max(100),
      berat: z.number().positive(),
      harga_beli_per_kg: z.number().positive(),
      kondisi_kualitas: z.string().max(50).optional(),
      sumber_input: z.enum(["voice", "manual"]),
      diterima_at: z.string().datetime(),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const body = c.req.valid("json");

    // Verifikasi supplier milik user ini
    const supplier = await db.query.suppliers.findFirst({
      where: (s, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(s.id, body.supplier_id), eqFn(s.userId, userId)),
    });

    if (!supplier) {
      return c.json(error("NOT_FOUND", "Supplier tidak ditemukan atau bukan milik Anda"), 404);
    }

    const [batch] = await db.insert(batches).values({
      userId,
      supplierId: body.supplier_id,
      jenisIkan: body.jenis_ikan,
      berat: body.berat.toString(), // stok awal = berat yang diterima
      hargaBeliPerKg: body.harga_beli_per_kg.toString(),
      kondisiKualitas: body.kondisi_kualitas,
      sumberInput: body.sumber_input,
      diterimaAt: new Date(body.diterima_at),
    }).returning();

    return c.json(success({ batch }), 201);
  }
);

// GET /batches/:id — detail batch + expenses
batchesRoute.get("/:id", async (c) => {
  const { id: userId } = c.get("user");
  const batchId = c.req.param("id");

  const batch = await db.query.batches.findFirst({
    where: and(eq(batches.id, batchId), eq(batches.userId, userId)),
    with: {
      suppliers: true,
      batchExpenses: true,
    },
  });

  if (!batch) {
    return c.json(error("NOT_FOUND", "Batch tidak ditemukan"), 404);
  }

  return c.json(success({
    batch: {
      ...batch,
      expenses: batch.batchExpenses,
    },
  }));
});

// PATCH /batches/:id — update field umum batch (kondisi_kualitas, status)
batchesRoute.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      kondisi_kualitas: z.string().max(50).optional(),
      status: z.enum(["aktif", "habis"]).optional(),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const batchId = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.batches.findFirst({
      where: and(eq(batches.id, batchId), eq(batches.userId, userId)),
    });

    if (!existing) {
      return c.json(error("NOT_FOUND", "Batch tidak ditemukan"), 404);
    }

    const updateData: Partial<typeof batches.$inferInsert> = {};
    if (body.kondisi_kualitas !== undefined) updateData.kondisiKualitas = body.kondisi_kualitas;
    if (body.status !== undefined) updateData.status = body.status;

    const [updated] = await db
      .update(batches)
      .set(updateData)
      .where(and(eq(batches.id, batchId), eq(batches.userId, userId)))
      .returning();

    return c.json(success({ batch: updated }));
  }
);

// POST /batches/:id/susut — catat ikan rusak/susut (Opsi B)
// Mengurangi `berat` (stok) dan sekaligus insert row ke BATCH_EXPENSES supaya
// kerugian rupiah-nya otomatis kepotong dari laba riil tanpa kolom/logika terpisah.
batchesRoute.post(
  "/:id/susut",
  zValidator(
    "json",
    z.object({
      berat_susut: z.number().positive(),
      catatan: z.string().max(255).optional(),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const batchId = c.req.param("id");
    const body = c.req.valid("json");

    const result = await db.transaction(async (tx) => {
      const existing = await tx.query.batches.findFirst({
        where: and(eq(batches.id, batchId), eq(batches.userId, userId)),
      });

      if (!existing) {
        throw { code: "NOT_FOUND", message: "Batch tidak ditemukan" };
      }

      const beratSaatIni = Number(existing.berat);
      if (body.berat_susut > beratSaatIni) {
        throw {
          code: "INSUFFICIENT_STOCK",
          message: `Berat susut (${body.berat_susut} kg) melebihi stok tersedia (${beratSaatIni} kg)`,
        };
      }

      const beratBaru = beratSaatIni - body.berat_susut;
      const jumlahKerugian = body.berat_susut * Number(existing.hargaBeliPerKg);

      const [updatedBatch] = await tx
        .update(batches)
        .set({
          berat: beratBaru.toString(),
          status: beratBaru === 0 ? "habis" : "aktif",
        })
        .where(and(eq(batches.id, batchId), eq(batches.userId, userId)))
        .returning();

      const [expense] = await tx.insert(batchExpenses).values({
        batchId,
        jenisBiaya: "Susut/Rusak",
        jumlah: jumlahKerugian.toString(),
        catatan: body.catatan || `Susut ${body.berat_susut} kg`,
      }).returning();

      return { batch: updatedBatch, expense };
    }).catch((err: any) => {
      if (err.code) throw err;
      throw err;
    });

    return c.json(success(result), 201);
  }
);

// Tangkap error structured dari transaction /:id/susut
batchesRoute.onError((err: any, c) => {
  if (err.code && err.message) {
    const status = err.code === "INSUFFICIENT_STOCK" ? 422 : 404;
    return c.json(error(err.code, err.message), status);
  }
  throw err;
});

// DELETE /batches/:id — hapus batch (tolak jika ada sales)
batchesRoute.delete("/:id", async (c) => {
  const { id: userId } = c.get("user");
  const batchId = c.req.param("id");

  const existing = await db.query.batches.findFirst({
    where: and(eq(batches.id, batchId), eq(batches.userId, userId)),
  });

  if (!existing) {
    return c.json(error("NOT_FOUND", "Batch tidak ditemukan"), 404);
  }

  // Cek apakah sudah ada sales terkait
  const [salesCount] = await db
    .select({ count: count() })
    .from(sales)
    .where(eq(sales.batchId, batchId));

  if (Number(salesCount.count) > 0) {
    return c.json(
      error("CONFLICT", `Batch tidak bisa dihapus karena memiliki ${salesCount.count} transaksi penjualan`),
      409
    );
  }

  // Hapus juga expenses terkait sebelum hapus batch
  await db.delete(batchExpenses).where(eq(batchExpenses.batchId, batchId));
  await db.delete(batches).where(and(eq(batches.id, batchId), eq(batches.userId, userId)));

  return new Response(null, { status: 204 });
});

export default batchesRoute;

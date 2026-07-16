import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { batches, buyers, sales, saleExtras, receipts } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";
import { generateReceiptNumber } from "../lib/receipt";

const salesRoute = new Hono();

salesRoute.use("*", authMiddleware);

// GET /sales — list transaksi dengan filter opsional
salesRoute.get("/", async (c) => {
  const { id: userId } = c.get("user");
  const { status_bayar, buyer_id, batch_id } = c.req.query();

  const result = await db.query.sales.findMany({
    where: (s, { and: andFn, eq: eqFn }) => {
      // Kita filter di query opsional
      const conditions: ReturnType<typeof eqFn>[] = [];
      if (status_bayar) conditions.push(eqFn(s.statusBayar, status_bayar as "lunas" | "tempo"));
      if (buyer_id) conditions.push(eqFn(s.buyerId, buyer_id));
      if (batch_id) conditions.push(eqFn(s.batchId, batch_id));
      return conditions.length ? andFn(...conditions) : undefined;
    },
    with: {
      batch: {
        columns: { userId: true, jenisIkan: true },
        where: (b, { eq: eqFn }) => eqFn(b.userId, userId),
      },
      buyer: { columns: { nama: true, tipePembeli: true } },
      saleExtras: true,
      receipt: { columns: { id: true, nomorStruk: true } },
    },
    orderBy: (s, { desc }) => [desc(s.tanggal)],
  });

  // Filter hasil — hanya sale yang batch-nya milik user ini
  const owned = result.filter((s) => s.batch !== null);

  return c.json(success({ sales: owned }));
});

// POST /sales — buat transaksi baru (atomic: kurangi stok + buat sale + buat receipt)
salesRoute.post(
  "/",
  zValidator(
    "json",
    z.object({
      batch_id: z.string().uuid(),
      buyer_id: z.string().uuid(),
      berat_jual: z.number().positive(),
      harga_satuan: z.number().positive(),
      status_bayar: z.enum(["lunas", "tempo"]),
      tanggal: z.string().datetime(),
      // Aksesoris opsional — bisa 0 atau lebih item
      extras: z.array(z.object({
        nama_item: z.string().min(1).max(100),
        jumlah: z.number().positive(),
        harga_satuan: z.number().positive(),
      })).optional().default([]),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const body = c.req.valid("json");

    try {
      // Verifikasi batch milik user dan cek stok — di dalam transaction
      const result = await db.transaction(async (tx) => {
        // Lock batch untuk update (cek stok)
        const batch = await tx.query.batches.findFirst({
          where: and(eq(batches.id, body.batch_id), eq(batches.userId, userId)),
        });

        if (!batch) {
          throw new Error("BATCH_NOT_FOUND:Batch tidak ditemukan");
        }

        const beratTersedia = Number(batch.berat);
        if (body.berat_jual > beratTersedia) {
          throw new Error(
            `INSUFFICIENT_STOCK:Berat jual (${body.berat_jual} kg) melebihi stok tersedia (${beratTersedia} kg)`
          );
        }

        // Verifikasi buyer milik user
        const buyer = await tx.query.buyers.findFirst({
          where: and(eq(buyers.id, body.buyer_id), eq(buyers.userId, userId)),
        });

        if (!buyer) {
          throw new Error("BUYER_NOT_FOUND:Pembeli tidak ditemukan");
        }

        // Hitung total aksesoris
        const extrasTotal = body.extras.reduce(
          (sum, e) => sum + e.jumlah * e.harga_satuan,
          0
        );
        const totalIkan = body.berat_jual * body.harga_satuan;
        const totalKeseluruhan = totalIkan + extrasTotal;

        // Buat sale
        const [sale] = await tx.insert(sales).values({
          batchId: body.batch_id,
          buyerId: body.buyer_id,
          beratJual: body.berat_jual.toString(),
          hargaSatuan: body.harga_satuan.toString(),
          total: totalKeseluruhan.toString(),
          statusBayar: body.status_bayar,
          tanggal: new Date(body.tanggal),
        }).returning();

        // Buat sale_extras jika ada
        let createdExtras: typeof saleExtras.$inferSelect[] = [];
        if (body.extras.length > 0) {
          createdExtras = await tx.insert(saleExtras).values(
            body.extras.map((e) => ({
              saleId: sale.id,
              namaItem: e.nama_item,
              jumlah: e.jumlah.toString(),
              hargaSatuan: e.harga_satuan.toString(),
              subtotal: (e.jumlah * e.harga_satuan).toString(),
            }))
          ).returning();
        }

        // Kurangi stok batch
        const beratBaru = beratTersedia - body.berat_jual;
        await tx
          .update(batches)
          .set({
            berat: beratBaru.toString(),
            status: beratBaru === 0 ? "habis" : "aktif",
          })
          .where(eq(batches.id, body.batch_id));

        // Auto-generate receipt
        const [receipt] = await tx.insert(receipts).values({
          saleId: sale.id,
          nomorStruk: generateReceiptNumber(),
        }).returning();

        return { sale, extras: createdExtras, receipt };
      });

      return c.json(success(result), 201);
    } catch (err: any) {
      // Tangkap error structured dari transaction
      if (err.message && err.message.includes(":")) {
        const [code, message] = err.message.split(":", 2);
        if (["BATCH_NOT_FOUND", "BUYER_NOT_FOUND", "INSUFFICIENT_STOCK"].includes(code)) {
          const status = code === "INSUFFICIENT_STOCK" ? 422 : 404;
          return c.json(error(code, message), status);
        }
      }
      throw err;
    }
  }
);

// GET /sales/:id — detail sale + payments + receipt
salesRoute.get("/:id", async (c) => {
  const { id: userId } = c.get("user");
  const saleId = c.req.param("id");

  const sale = await db.query.sales.findFirst({
    where: eq(sales.id, saleId),
    with: {
      batch: {
        columns: { userId: true, jenisIkan: true, berat: true },
      },
      buyer: true,
      payments: { orderBy: (p, { asc }) => [asc(p.dibayarAt)] },
      receipt: true,
      saleExtras: true,
    },
  });

  if (!sale || sale.batch.userId !== userId) {
    return c.json(error("NOT_FOUND", "Transaksi tidak ditemukan"), 404);
  }

  return c.json(success({
    sale: {
      ...sale,
      batch: sale.batch,
      buyer: sale.buyer,
      payments: sale.payments,
      receipt: sale.receipt,
      extras: sale.saleExtras,
    },
  }));
});

export default salesRoute;

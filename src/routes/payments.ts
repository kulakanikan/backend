import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, sum } from "drizzle-orm";
import { db } from "../db/client";
import { sales, payments } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";

const paymentsRoute = new Hono();

paymentsRoute.use("*", authMiddleware);

// Helper: verifikasi sale milik user (via batch user_id)
async function getSaleForUser(saleId: string, userId: string) {
  const sale = await db.query.sales.findFirst({
    where: eq(sales.id, saleId),
    with: {
      batch: { columns: { userId: true } },
    },
  });

  if (!sale || sale.batch.userId !== userId) return null;
  return sale;
}

// POST /sales/:id/payments — tambah cicilan pembayaran
paymentsRoute.post(
  "/sales/:id/payments",
  zValidator(
    "json",
    z.object({
      jumlah_bayar: z.number().positive(),
      metode_bayar: z.string().min(1).max(50),
      dibayar_at: z.string().datetime().optional(),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const saleId = c.req.param("id");
    const body = c.req.valid("json");

    const sale = await getSaleForUser(saleId, userId);
    if (!sale) {
      return c.json(error("NOT_FOUND", "Transaksi tidak ditemukan"), 404);
    }

    // Cek apakah sudah lunas sebelum tambah payment
    if (sale.statusBayar === "lunas") {
      return c.json(
        error("CONFLICT", "Transaksi ini sudah berstatus lunas, tidak perlu menambah pembayaran"),
        409
      );
    }

    const result = await db.transaction(async (tx) => {
      // Tambah payment record
      const [payment] = await tx.insert(payments).values({
        saleId,
        jumlahBayar: body.jumlah_bayar.toString(),
        metodeBayar: body.metode_bayar,
        dibayarAt: body.dibayar_at ? new Date(body.dibayar_at) : new Date(),
      }).returning();

      // Hitung total semua payments untuk sale ini (termasuk yang baru)
      const [totalResult] = await tx
        .select({ total: sum(payments.jumlahBayar) })
        .from(payments)
        .where(eq(payments.saleId, saleId));

      const totalPaid = Number(totalResult.total || 0);
      const saleTotal = Number(sale.total);
      const isFullyPaid = totalPaid >= saleTotal;

      // Update status_bayar jika sudah lunas
      let saleStatusUpdated = false;
      if (isFullyPaid && sale.statusBayar !== "lunas") {
        await tx
          .update(sales)
          .set({ statusBayar: "lunas" })
          .where(eq(sales.id, saleId));
        saleStatusUpdated = true;
      }

      return {
        payment,
        sale_status_updated: saleStatusUpdated,
        total_paid: totalPaid,
        sale_total: saleTotal,
        remaining: Math.max(0, saleTotal - totalPaid),
      };
    });

    return c.json(success(result), 201);
  }
);

// GET /sales/:id/payments — list semua payments untuk satu sale
paymentsRoute.get("/sales/:id/payments", async (c) => {
  const { id: userId } = c.get("user");
  const saleId = c.req.param("id");

  const sale = await getSaleForUser(saleId, userId);
  if (!sale) {
    return c.json(error("NOT_FOUND", "Transaksi tidak ditemukan"), 404);
  }

  const paymentsList = await db.query.payments.findMany({
    where: eq(payments.saleId, saleId),
    orderBy: (p, { asc }) => [asc(p.dibayarAt)],
  });

  return c.json(success({ payments: paymentsList }));
});

export default paymentsRoute;

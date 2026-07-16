import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { batchExpenses, batches } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";

const batchExpensesRoute = new Hono();

batchExpensesRoute.use("*", authMiddleware);

// Helper: verifikasi batch milik user
async function getBatchForUser(batchId: string, userId: string) {
  return db.query.batches.findFirst({
    where: and(eq(batches.id, batchId), eq(batches.userId, userId)),
  });
}

// POST /batches/:id/expenses — tambah biaya ke batch
batchExpensesRoute.post(
  "/batches/:id/expenses",
  zValidator(
    "json",
    z.object({
      jenis_biaya: z.string().min(1).max(100),
      jumlah: z.number().positive(),
      catatan: z.string().optional(),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const batchId = c.req.param("id");
    const body = c.req.valid("json");

    const batch = await getBatchForUser(batchId, userId);
    if (!batch) {
      return c.json(error("NOT_FOUND", "Batch tidak ditemukan"), 404);
    }

    const [expense] = await db.insert(batchExpenses).values({
      batchId,
      jenisBiaya: body.jenis_biaya,
      jumlah: body.jumlah.toString(),
      catatan: body.catatan,
    }).returning();

    return c.json(success({ expense }), 201);
  }
);

// GET /batches/:id/expenses — list expenses suatu batch
batchExpensesRoute.get("/batches/:id/expenses", async (c) => {
  const { id: userId } = c.get("user");
  const batchId = c.req.param("id");

  const batch = await getBatchForUser(batchId, userId);
  if (!batch) {
    return c.json(error("NOT_FOUND", "Batch tidak ditemukan"), 404);
  }

  const expenses = await db.query.batchExpenses.findMany({
    where: eq(batchExpenses.batchId, batchId),
    orderBy: (e, { asc }) => [asc(e.createdAt)],
  });

  return c.json(success({ expenses }));
});

// DELETE /batch-expenses/:id — hapus satu expense
batchExpensesRoute.delete("/batch-expenses/:id", async (c) => {
  const { id: userId } = c.get("user");
  const expenseId = c.req.param("id");

  // Pastikan expense ada dan batch-nya milik user ini
  const expense = await db.query.batchExpenses.findFirst({
    where: eq(batchExpenses.id, expenseId),
    with: { batch: true },
  });

  if (!expense || expense.batch.userId !== userId) {
    return c.json(error("NOT_FOUND", "Expense tidak ditemukan"), 404);
  }

  await db.delete(batchExpenses).where(eq(batchExpenses.id, expenseId));
  return new Response(null, { status: 204 });
});

export default batchExpensesRoute;

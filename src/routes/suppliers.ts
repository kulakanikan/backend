import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, count } from "drizzle-orm";
import { db } from "../db/client";
import { suppliers, batches } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";

const suppliersRoute = new Hono();

suppliersRoute.use("*", authMiddleware);

// GET /suppliers — list semua supplier milik user
suppliersRoute.get("/", async (c) => {
  const { id: userId } = c.get("user");

  const result = await db.query.suppliers.findMany({
    where: eq(suppliers.userId, userId),
    orderBy: (suppliers, { asc }) => [asc(suppliers.namaNelayan)],
  });

  return c.json(success({ suppliers: result }));
});

// POST /suppliers — tambah supplier baru
suppliersRoute.post(
  "/",
  zValidator(
    "json",
    z.object({
      nama_nelayan: z.string().min(1).max(255),
      telepon: z.string().max(30).optional(),
      alamat: z.string().optional(),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const body = c.req.valid("json");

    const [supplier] = await db.insert(suppliers).values({
      userId,
      namaNelayan: body.nama_nelayan,
      telepon: body.telepon,
      alamat: body.alamat,
    }).returning();

    return c.json(success({ supplier }), 201);
  }
);

// GET /suppliers/:id — detail satu supplier
suppliersRoute.get("/:id", async (c) => {
  const { id: userId } = c.get("user");
  const supplierId = c.req.param("id");

  const supplier = await db.query.suppliers.findFirst({
    where: and(eq(suppliers.id, supplierId), eq(suppliers.userId, userId)),
  });

  if (!supplier) {
    return c.json(error("NOT_FOUND", "Supplier tidak ditemukan"), 404);
  }

  return c.json(success({ supplier }));
});

// PATCH /suppliers/:id — update data supplier
suppliersRoute.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      nama_nelayan: z.string().min(1).max(255).optional(),
      telepon: z.string().max(30).nullable().optional(),
      alamat: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const supplierId = c.req.param("id");
    const body = c.req.valid("json");

    // Pastikan supplier milik user ini
    const existing = await db.query.suppliers.findFirst({
      where: and(eq(suppliers.id, supplierId), eq(suppliers.userId, userId)),
    });

    if (!existing) {
      return c.json(error("NOT_FOUND", "Supplier tidak ditemukan"), 404);
    }

    const updateData: Partial<typeof suppliers.$inferInsert> = {};
    if (body.nama_nelayan !== undefined) updateData.namaNelayan = body.nama_nelayan;
    if (body.telepon !== undefined) updateData.telepon = body.telepon;
    if (body.alamat !== undefined) updateData.alamat = body.alamat;

    const [updated] = await db
      .update(suppliers)
      .set(updateData)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.userId, userId)))
      .returning();

    return c.json(success({ supplier: updated }));
  }
);

// DELETE /suppliers/:id — hapus supplier (tolak jika masih ada batch)
suppliersRoute.delete("/:id", async (c) => {
  const { id: userId } = c.get("user");
  const supplierId = c.req.param("id");

  // Pastikan supplier milik user ini
  const existing = await db.query.suppliers.findFirst({
    where: and(eq(suppliers.id, supplierId), eq(suppliers.userId, userId)),
  });

  if (!existing) {
    return c.json(error("NOT_FOUND", "Supplier tidak ditemukan"), 404);
  }

  // Cek apakah masih ada batch terkait
  const [batchCount] = await db
    .select({ count: count() })
    .from(batches)
    .where(eq(batches.supplierId, supplierId));

  if (Number(batchCount.count) > 0) {
    return c.json(
      error(
        "CONFLICT",
        `Supplier tidak bisa dihapus karena masih memiliki ${batchCount.count} batch terkait`
      ),
      409
    );
  }

  await db
    .delete(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.userId, userId)));

  return new Response(null, { status: 204 });
});

export default suppliersRoute;

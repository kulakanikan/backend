import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { verifyGoogleToken } from "../services/google-auth";
import { signJWT } from "../services/jwt";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";

const auth = new Hono();

auth.post(
  "/google",
  zValidator("json", z.object({ id_token: z.string().min(1) })),
  async (c) => {
    const { id_token } = c.req.valid("json");

    let googleUser;
    try {
      googleUser = await verifyGoogleToken(id_token);
    } catch (err) {
      return c.json(error("INVALID_TOKEN", "Google id_token tidak valid atau expired"), 401);
    }

    let user = await db.query.users.findFirst({
      where: eq(users.googleSub, googleUser.sub),
    });

    if (!user) {
      const [newUser] = await db.insert(users).values({
        googleSub: googleUser.sub,
        nama: googleUser.name,
        email: googleUser.email,
        avatarUrl: googleUser.picture,
      }).returning();
      user = newUser;
    }

    const token = await signJWT({
      sub: user.id,
      email: user.email,
      nama: user.nama,
    });

    return c.json(success({
      token,
      user: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        avatarUrl: user.avatarUrl,
        namaUsaha: user.namaUsaha,
        teleponUsaha: user.teleponUsaha,
      },
    }));
  }
);

// DEV-ONLY: Login dengan google_sub langsung (tanpa OAuth flow)
auth.post(
  "/dev-login",
  zValidator("json", z.object({ google_sub: z.string().min(1) })),
  async (c) => {
    const { google_sub } = c.req.valid("json");

    const user = await db.query.users.findFirst({
      where: eq(users.googleSub, google_sub),
    });

    if (!user) {
      return c.json(error("USER_NOT_FOUND", "User dengan google_sub tersebut tidak ditemukan"), 404);
    }

    const token = await signJWT({
      sub: user.id,
      email: user.email,
      nama: user.nama,
    });

    return c.json(success({
      token,
      user: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        avatarUrl: user.avatarUrl,
        namaUsaha: user.namaUsaha,
        teleponUsaha: user.teleponUsaha,
      },
    }));
  }
);

auth.get("/me", authMiddleware, async (c) => {
  const { id } = c.get("user");

  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });

  if (!user) {
    return c.json(error("USER_NOT_FOUND", "User tidak ditemukan"), 404);
  }

  return c.json(success({
    user: {
      id: user.id,
      nama: user.nama,
      email: user.email,
      avatarUrl: user.avatarUrl,
      namaUsaha: user.namaUsaha,
      teleponUsaha: user.teleponUsaha,
    },
  }));
});

export default auth;

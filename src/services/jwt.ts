import { SignJWT, jwtVerify } from "jose";

const JWT_EXPIRY = "7d";

function getSecret() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export type JWTPayload = {
  sub: string;
  email: string;
  nama: string;
};

export async function signJWT(payload: JWTPayload): Promise<string> {
  return new SignJWT({ email: payload.email, nama: payload.nama })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}

export async function verifyJWT(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return {
    sub: payload.sub as string,
    email: payload.email as string,
    nama: payload.nama as string,
  };
}

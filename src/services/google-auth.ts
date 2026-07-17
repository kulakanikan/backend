export type GoogleUserInfo = {
  sub: string;
  email: string;
  name: string;
  picture: string;
};

export async function verifyGoogleToken(idToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
  );

  if (!response.ok) {
    throw new Error("Failed to verify Google token");
  }

  const data = await response.json() as Record<string, string>;

  const expectedClientId = process.env.GOOGLE_CLIENT_ID;
  const audienceMatches =
    data.aud === expectedClientId || data.azp === expectedClientId;

  if (!audienceMatches) {
    throw new Error("Token audience mismatch — token bukan untuk app ini");
  }

  const expiry = Number(data.exp) * 1000;
  if (Date.now() > expiry) {
    throw new Error("Google token sudah expired");
  }

  if (!data.sub || !data.email || !data.name) {
    throw new Error("Token payload tidak lengkap");
  }

  return {
    sub: data.sub,
    email: data.email,
    name: data.name,
    picture: data.picture || "",
  };
}

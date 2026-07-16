/**
 * Generate nomor struk unik format: STR-YYYYMMDD-XXXXXX
 * Contoh: STR-20260716-A1B2C3
 */
export function generateReceiptNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 chars
  return `STR-${date}-${random}`;
}

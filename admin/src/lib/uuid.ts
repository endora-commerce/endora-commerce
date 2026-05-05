/**
 * Browser-friendly UUID v4 generator. Uses `crypto.randomUUID` when
 * available (every modern browser + every Node ≥ 19); falls back to a
 * RFC-4122-compliant Math.random implementation otherwise so the admin
 * bundle never depends on the Node `crypto` module.
 */
export function randomUUID(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  // Fallback — RFC 4122 v4 via Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const r = (Math.random() * 16) | 0;
    const v = char === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

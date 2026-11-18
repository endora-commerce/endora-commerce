/**
 * What an uploaded file is, by its first bytes (`specs/180-off-platform-complaints/`
 * FR-B20, research R-12). The declared MIME type is the browser's guess and an
 * attacker's choice; only JPEG, PNG, WebP and PDF are accepted, and the type stored —
 * and served back with `nosniff` — is the one read here. `null`: not one of the four.
 */
export type AcceptedAttachmentMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export function sniffAttachmentType(bytes: Uint8Array): AcceptedAttachmentMime | null {
  const starts = (signature: readonly number[], offset = 0): boolean =>
    bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

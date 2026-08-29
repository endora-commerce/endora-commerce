/**
 * Opaque cursor encoding shared by every list endpoint.
 * The backend composes a composite key (for example `${createdAt}:${id}`) and emits it
 * as base64url via these helpers; clients treat the cursor as opaque and pass it back.
 * See specs/001-b2b-platform-foundation/contracts/README.md.
 */

export function encodeCursor(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}

/** Returns undefined on malformed input so callers can 400 the request. */
export function decodeCursor(cursor: string): string | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

import { createCipheriv, createDecipheriv, createHmac, hkdfSync } from 'node:crypto';

/**
 * Sealed pagination cursors (issue #497).
 *
 * `encodeCursor` (`../http/cursor.ts`) is base64 of a key, and every listing
 * that pages by a keyset of what its client already sees is right to use it.
 * A listing whose next position can be a row its client must not learn about —
 * the catalogue's price-ordered walk, whose scan budget can stop it on a product
 * the viewer may not see or whose price is withheld, with that product's amount
 * and id in the keyset — seals its cursor instead: the client gets a token it
 * can hand back and cannot read or forge.
 *
 * AES-256-GCM from `node:crypto`, no new dependency (Principle IV). The key is
 * derived with HKDF from the secret the host passes — the session key, which a
 * production instance refuses to start without — so there is no new input for an
 * operator to provision. The derived key serves this seal and nothing else, and
 * the seal serves **purpose-bound tokens**, of which a pagination cursor is the
 * first kind: `returns` seals its guest links with it too
 * (`specs/181-guest-complaints/` research R-5, owner ruling of 2026-11-16) —
 * `returns.guest-verify.v1` for the one-time e-mail verification link and
 * `returns.guest-tracking.v1` for a guest's case tracking link. The purpose keeps
 * every kind apart: a token sealed for one opens for no other. Rotating the
 * session key therefore also makes cursors in flight unreadable and voids every
 * guest link; a listing answers an unreadable cursor as one it cannot parse, and
 * `returns` answers an unreadable link as an invalid one.
 *
 * The token is `base64url(version ‖ iv ‖ tag ‖ ciphertext)`. The purpose is the
 * GCM additional data, so a cursor sealed by one listing opens in no other. The
 * plaintext is padded to a multiple of {@link PAD_BLOCK} bytes (ISO/IEC 7816-4:
 * `0x80`, then zeros), so a token's length does not follow the number of digits
 * in an amount it carries.
 *
 * **Deterministic, on purpose.** The IV is synthetic — an HMAC of the purpose
 * and the payload under a second derived key — so one position always seals to
 * one token. A storefront renders a cursor into a link: with a random IV every
 * render of the same page would name its next page by a new URL, which a cache
 * cannot reuse and a crawler would follow without end (Principle VII). What
 * determinism discloses is that two cursors name the same position, which a
 * client reading the two pages they lead to already knows. The IV still never
 * repeats across two different plaintexts short of an HMAC collision, which is
 * the condition GCM needs.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 0x01;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
/** The encryption key, then the key the synthetic IV is computed with. */
const DERIVED_LENGTH = 2 * KEY_LENGTH;
const PAD_BLOCK = 128;
const HKDF_SALT = 'endora-commerce/cursor-seal';
const HKDF_INFO = 'v1';

/** Seals and opens cursors; see {@link createCursorSeal}. */
export interface CursorSeal {
  /** A URL-safe token for `payload` that reveals nothing of it and opens only for `purpose`. */
  seal(purpose: string, payload: string): string;
  /**
   * The payload sealed for `purpose`, or `null` for anything else: a token
   * sealed for another purpose or with another key, an altered one, a cursor of
   * an unsealed format, garbage.
   */
  open(purpose: string, token: string): string | null;
}

/**
 * The seal for this instance. The key is derived on first use, so a process
 * that composes without a session key (a CLI command, say) is not refused for a
 * listing it never serves; a seal or an open without one throws.
 */
export function createCursorSeal(secret: string): CursorSeal {
  let keys: { enc: Buffer; iv: Buffer } | null = null;
  const keysOf = (): { enc: Buffer; iv: Buffer } => {
    if (secret === '') {
      throw new Error('Cursor seal has no key: the session secret (SESSION_COOKIE_SECRET) is empty.');
    }
    if (keys === null) {
      const derived = Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, DERIVED_LENGTH));
      keys = { enc: derived.subarray(0, KEY_LENGTH), iv: derived.subarray(KEY_LENGTH) };
    }
    return keys;
  };

  return {
    seal(purpose, payload) {
      const { enc, iv: ivKey } = keysOf();
      const aad = Buffer.from(purpose, 'utf8');
      const plain = pad(Buffer.from(payload, 'utf8'));
      // Length-prefixed, so no purpose/payload pair reads as another.
      const aadLength = Buffer.alloc(4);
      aadLength.writeUInt32BE(aad.length);
      const iv = createHmac('sha256', ivKey)
        .update(aadLength)
        .update(aad)
        .update(plain)
        .digest()
        .subarray(0, IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, enc, iv, { authTagLength: TAG_LENGTH });
      cipher.setAAD(aad);
      const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]).toString('base64url');
    },

    open(purpose, token) {
      const { enc: k } = keysOf();
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.length < 1 + IV_LENGTH + TAG_LENGTH + PAD_BLOCK || bytes[0] !== VERSION) return null;
      // `Buffer.from(…, 'base64url')` skips what it cannot read rather than
      // refusing it, so a token is only what it re-encodes to.
      if (bytes.toString('base64url') !== token) return null;
      const iv = bytes.subarray(1, 1 + IV_LENGTH);
      const tag = bytes.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
      const ct = bytes.subarray(1 + IV_LENGTH + TAG_LENGTH);
      try {
        const decipher = createDecipheriv(ALGORITHM, k, iv, { authTagLength: TAG_LENGTH });
        decipher.setAAD(Buffer.from(purpose, 'utf8'));
        decipher.setAuthTag(tag);
        const padded = Buffer.concat([decipher.update(ct), decipher.final()]);
        return unpad(padded)?.toString('utf8') ?? null;
      } catch {
        return null;
      }
    },
  };
}

function pad(plain: Buffer): Buffer {
  const length = Math.ceil((plain.length + 1) / PAD_BLOCK) * PAD_BLOCK;
  const out = Buffer.alloc(length);
  plain.copy(out);
  out[plain.length] = 0x80;
  return out;
}

function unpad(padded: Buffer): Buffer | null {
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  return end >= 0 && padded[end] === 0x80 ? padded.subarray(0, end) : null;
}

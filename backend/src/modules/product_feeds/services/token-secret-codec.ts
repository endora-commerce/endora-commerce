import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Recoverable storage for a feed's access token.
 *
 * This is a DELIBERATE, narrowed copy of
 * `credentials/services/secret-value-codec.ts`, which is itself a sanctioned
 * copy of the settings module's. Importing another module's private codec would
 * couple the two (Principle I) and break independent removability; ~60 LOC of
 * duplication is the constitution-preferred trade (Principle IV). All three
 * read the SAME env key `SETTINGS_SECRET_ENCRYPTION_KEY` (base64, 32 bytes), so
 * there is no new secret to provision and the envelopes are interchangeable.
 *
 * Two differences from the credentials codec, both because the caller is
 * different:
 *
 *  - **There is no legacy plaintext form.** A feed token was never stored as a
 *    string, so `decryptFeedToken` accepts only an envelope.
 *  - **Nothing here fails the request.** A token that cannot be decrypted — no
 *    key configured, key rotated, envelope written by a different deployment —
 *    means the admin falls back to the masked display it had before. Refusing
 *    to render the feed page over an unreadable *convenience* copy would turn a
 *    display problem into an outage, and `token_hash` (the thing that actually
 *    authorizes) is unaffected either way.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export interface FeedTokenEnvelope {
  v: 1;
  alg: typeof ALGORITHM;
  iv: string;
  ct: string;
  tag: string;
}

export function isFeedTokenEnvelope(value: unknown): value is FeedTokenEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['v'] === 1 &&
    v['alg'] === ALGORITHM &&
    typeof v['iv'] === 'string' &&
    typeof v['ct'] === 'string' &&
    typeof v['tag'] === 'string'
  );
}

function keyBuffer(keyBase64: string): Buffer | null {
  const key = Buffer.from(keyBase64, 'base64');
  return key.length === KEY_LENGTH ? key : null;
}

/**
 * Encrypts the plaintext token, or returns `null` when no usable key is
 * configured.
 *
 * Null rather than a throw: issuing a token must keep working on a deployment
 * that has not provisioned the encryption key. Such a feed simply behaves the
 * way every feed did before this existed — the URL is shown once and then
 * masked.
 */
export function encryptFeedToken(
  token: string,
  keyBase64: string | undefined,
): FeedTokenEnvelope | null {
  if (!keyBase64) return null;
  const key = keyBuffer(keyBase64);
  if (!key) return null;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: ALGORITHM,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** The plaintext token, or `null` for anything that is not readable right now. */
export function decryptFeedToken(
  stored: unknown,
  keyBase64: string | undefined,
): string | null {
  if (!isFeedTokenEnvelope(stored) || !keyBase64) return null;
  const key = keyBuffer(keyBase64);
  if (!key) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(stored.ct, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // A failed auth tag means the envelope was written under a different key.
    // The masked fallback is the honest answer; a 500 here would be a worse one.
    return null;
  }
}

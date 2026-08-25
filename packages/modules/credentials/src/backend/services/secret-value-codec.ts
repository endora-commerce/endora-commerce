import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Secret-value codec for credential-configuration secret fields (feature 058,
 * research §R4).
 *
 * This is a verbatim duplication of the codec that used to live at
 * `settings/services/secret-value-codec.ts`. The original justification —
 * importing the settings module's private codec across a module boundary would
 * couple the two modules (Principle I) and break independent removability — no
 * longer holds: feature 072 T018 moved that codec into the kernel
 * (`kernel/settings/secret-value-codec.ts`), and a module may import the kernel.
 * The duplication is therefore now debt, not a trade; it is left in place here
 * because collapsing it is a behaviour-carrying change, not part of the
 * relocation. Both codecs read the SAME
 * env key `SETTINGS_SECRET_ENCRYPTION_KEY` (base64, 32 bytes) — no new secret to
 * provision — and produce self-describing envelopes, so a value written by one
 * decrypts under the other.
 *
 * There is NO plaintext fallback on write: encrypting without a key throws
 * {@link SecretKeyMissing} (fail-closed, the desired behaviour for credentials).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export interface SecretEnvelope {
  v: 1;
  alg: typeof ALGORITHM;
  iv: string;
  ct: string;
  tag: string;
}

export class SecretKeyMissing extends Error {
  override readonly name = 'SecretKeyMissing';
  readonly code = 'SETTING_SECRET_KEY_MISSING' as const;
  constructor() {
    super(
      'SETTINGS_SECRET_ENCRYPTION_KEY is not configured — secret credential fields cannot be processed.',
    );
  }
}

/**
 * The encryption key is present but not a valid AES-256 key (must decode to
 * exactly 32 bytes). Carries the same error code as {@link SecretKeyMissing} so
 * callers surface a clear 5xx instead of a bare "Internal server error".
 */
export class SecretKeyInvalid extends Error {
  override readonly name = 'SecretKeyInvalid';
  readonly code = 'SETTING_SECRET_KEY_MISSING' as const;
  constructor(actualBytes: number) {
    super(
      `SETTINGS_SECRET_ENCRYPTION_KEY is misconfigured — it must decode to ${KEY_LENGTH} bytes ` +
        `(got ${actualBytes}). Set it to 32 random bytes, base64-encoded (e.g. \`openssl rand -base64 32\`).`,
    );
  }
}

function keyBuffer(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new SecretKeyInvalid(key.length);
  }
  return key;
}

export function isSecretEnvelope(value: unknown): value is SecretEnvelope {
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

export function encryptSecretValue(
  plaintext: string,
  keyBase64: string | undefined,
): SecretEnvelope {
  if (!keyBase64) throw new SecretKeyMissing();
  const key = keyBuffer(keyBase64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: ALGORITHM,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * Resolve a stored secret value to its plaintext. Plain strings are legacy
 * pre-encryption values and pass through unchanged; envelopes require the key
 * and an intact auth tag.
 */
export function decryptSecretValue(
  stored: unknown,
  keyBase64: string | undefined,
): string {
  if (typeof stored === 'string') return stored;
  if (!isSecretEnvelope(stored)) {
    throw new Error('Stored secret value is neither a string nor a v1 secret envelope.');
  }
  if (!keyBase64) throw new SecretKeyMissing();
  const key = keyBuffer(keyBase64);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(stored.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(stored.ct, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** A secret counts as "set" when it is an envelope or a non-empty legacy string. */
export function secretValueIsSet(stored: unknown): boolean {
  if (isSecretEnvelope(stored)) return true;
  return typeof stored === 'string' && stored.length > 0;
}

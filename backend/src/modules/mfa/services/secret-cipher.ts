import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/**
 * Authenticated encryption for the TOTP secret at rest (feature 042, R7).
 *
 * AES-256-GCM via Node's built-in crypto — no new dependency. The 32-byte key
 * comes from `MFA_SECRET_ENCRYPTION_KEY` (base64). Each enrolment row stores
 * its own random 12-byte IV and the GCM auth tag, so a leaked database does
 * not yield working TOTP secrets.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export class SecretCipher {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `MFA_SECRET_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}).`,
      );
    }
    this.key = key;
  }

  /** Encrypt a plaintext secret (the base32 TOTP secret). */
  encrypt(plaintext: string): EncryptedSecret {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return { ciphertext, iv, authTag };
  }

  /** Decrypt; throws if the ciphertext or tag has been tampered with. */
  decrypt(secret: EncryptedSecret): string {
    const decipher = createDecipheriv(ALGORITHM, this.key, secret.iv);
    decipher.setAuthTag(secret.authTag);
    const plaintext = Buffer.concat([
      decipher.update(secret.ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}

/** Timing-safe equality for two same-length hex/base64 strings. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

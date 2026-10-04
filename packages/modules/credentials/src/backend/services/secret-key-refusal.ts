import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { SecretKeyInvalid, SecretKeyMissing } from './secret-value-codec.js';

/**
 * Run a secret-codec call and turn a key fault into a refusal a client can read.
 *
 * `SecretKeyMissing` and `SecretKeyInvalid` are plain `Error` subclasses, and
 * the error envelope takes a code off an `HttpError` and off nothing else — so
 * left alone, an instance started without `SETTINGS_SECRET_ENCRYPTION_KEY`
 * answers `500 INTERNAL` "Internal server error." to an operator saving a
 * gateway credential, which names neither the variable nor the fix. The codec's
 * own message does both, and this is what lets it reach them.
 *
 * Still a 500 and still fail-closed: the deployment is misconfigured, nothing
 * the caller sent is wrong, and nothing is stored or decrypted. The code is
 * `settings`' — the same one that module raises for the same key, read from the
 * same variable — rather than a second name for one fault.
 *
 * Anything else the codec throws (a tampered envelope, a stored value of an
 * unknown shape) is not the operator's missing variable and passes through.
 */
export function withSecretKeyRefusal<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof SecretKeyMissing || err instanceof SecretKeyInvalid) {
      throw new HttpError(500, ERROR_CODES.SETTING_SECRET_KEY_MISSING, err.message);
    }
    throw err;
  }
}

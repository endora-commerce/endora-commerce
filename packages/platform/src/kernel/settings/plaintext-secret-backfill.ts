import type { EntityManager } from '@mikro-orm/postgresql';
import { Setting } from './setting.entity.js';
import { SettingValue } from './setting-value.entity.js';
import type { SettingsCacheInvalidation } from './settings-cache.js';
import { SecretKeyInvalid, SecretKeyMissing, encryptSecretValue } from './secret-value-codec.js';

/**
 * Encrypting the plaintext a `secret` setting still stores (issue #700).
 *
 * A setting whose type moved from `string` to `secret` keeps every value it was
 * given as a string: the codec reads a plain string back unchanged, so nothing
 * forced a re-encryption, and a per-channel row its module no longer reads is
 * never saved again. #333 made that move for the S3/GCS credentials.
 *
 * Two callers, one rule:
 *
 *   - `ManifestReconciler` applies `string` → `secret` and encrypts the code's
 *     values in the same unit of work as the type change;
 *   - {@link backfillPlaintextSecrets} runs at boot over every `secret` setting,
 *     which is what reaches a database that took the type change before the
 *     reconciler encrypted anything.
 *
 * Only a **non-empty string** is plaintext. An envelope is left exactly as it is
 * (never re-encrypted, so the backfill is idempotent), an empty string means
 * "not set" and would look set once encrypted (`secretValueIsSet`), and the
 * manifest `defaultValue` is not an operator's value.
 *
 * Without a usable key the values are left as they are and a warning names each
 * code. A secret **write** without a key is refused (`SecretKeyMissing`), but a
 * boot is not a write an operator can retry, and failing it would take down a
 * deployment that runs today; the warning is the least committal answer.
 */

export interface PlaintextSecretOptions {
  /** Base64 32-byte key, `SETTINGS_SECRET_ENCRYPTION_KEY`. Absent → warn only. */
  readonly secretEncryptionKey?: string | undefined;
  /** Where the "left as plaintext" warning goes. Defaults to the console. */
  readonly warn?: ((message: string) => void) | undefined;
}

export interface PlaintextSecretOutcome {
  /** Codes at least one of whose stored values was encrypted. */
  readonly encryptedCodes: readonly string[];
  /** Codes that hold plaintext and were left alone, for want of a usable key. */
  readonly plaintextCodes: readonly string[];
}

function isPlaintext(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function defaultWarn(message: string): void {
  // Boot-time logging path; the Fastify logger is not available here.
  console.warn(message);
}

/** Why no value can be encrypted with this key, or `null` when it is usable. */
function keyProblem(key: string | undefined): string | null {
  try {
    encryptSecretValue('', key);
    return null;
  } catch (err) {
    if (err instanceof SecretKeyMissing) return 'SETTINGS_SECRET_ENCRYPTION_KEY is not set';
    if (err instanceof SecretKeyInvalid) return err.message;
    throw err;
  }
}

/**
 * Encrypt, in place, every plaintext value the given `secret` settings store.
 * Mutates managed entities and does **not** flush: the caller's unit of work
 * carries the change, so it commits with whatever else that work writes.
 */
export async function encryptPlaintextSecretValues(
  em: EntityManager,
  settings: readonly Setting[],
  options: PlaintextSecretOptions = {},
): Promise<PlaintextSecretOutcome> {
  if (settings.length === 0) return { encryptedCodes: [], plaintextCodes: [] };
  const warn = options.warn ?? defaultWarn;
  const key = options.secretEncryptionKey;
  const problem = keyProblem(key);

  const values = await em.find(SettingValue, {
    setting: { $in: settings.map((s) => s.id) },
  });
  const valuesBySetting = new Map<string, SettingValue[]>();
  for (const row of values) {
    const id = row.setting.id;
    valuesBySetting.set(id, [...(valuesBySetting.get(id) ?? []), row]);
  }

  const encryptedCodes: string[] = [];
  const plaintextCodes: string[] = [];
  for (const setting of settings) {
    const rows = (valuesBySetting.get(setting.id) ?? []).filter((r) => isPlaintext(r.value));
    const globalValue = setting.globalValue;
    const count = rows.length + (isPlaintext(globalValue) ? 1 : 0);
    if (count === 0) continue;

    if (problem !== null) {
      plaintextCodes.push(setting.code);
      warn(
        `[settings] secret setting "${setting.code}" stores ${count} plaintext value(s), left ` +
          `unencrypted because ${problem}. Set SETTINGS_SECRET_ENCRYPTION_KEY (a base64 32-byte ` +
          'key) and restart: the values are encrypted at the next boot.',
      );
      continue;
    }

    if (isPlaintext(globalValue)) setting.globalValue = encryptSecretValue(globalValue, key);
    for (const row of rows) row.value = encryptSecretValue(row.value as string, key);
    encryptedCodes.push(setting.code);
  }
  return { encryptedCodes, plaintextCodes };
}

/**
 * The boot backfill: every `secret` setting in the database, whichever module
 * owns it and whether or not its manifest is reconciled at boot. Flushes when
 * it changed something, then drops the cache entries of every code that held
 * plaintext — encrypted or not, since a process may have cached it before
 * `SettingsService` stopped caching a plaintext secret.
 */
export async function backfillPlaintextSecrets(
  em: EntityManager,
  options: PlaintextSecretOptions & {
    readonly cache?: SettingsCacheInvalidation | undefined;
  } = {},
): Promise<PlaintextSecretOutcome> {
  // command-coverage-ignore: idempotent boot repair of stored values — a
  // system-invariant repair, not an operator-initiated audited write.
  const settings = await em.find(Setting, { valueType: 'secret' });
  const outcome = await encryptPlaintextSecretValues(em, settings, options);
  if (outcome.encryptedCodes.length > 0) await em.flush();
  if (options.cache) {
    for (const code of [...outcome.encryptedCodes, ...outcome.plaintextCodes]) {
      await options.cache.invalidateAfterWrite(code);
    }
  }
  return outcome;
}

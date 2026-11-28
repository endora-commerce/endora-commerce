/**
 * A refused save, mapped onto the declared form's fields
 * (`specs/193-admin-form-extensions/` `contracts/field-rules.md` §6,
 * `field-slots.md` §4).
 *
 * Every refusal the write path can raise carries `details[]` with a `path`:
 * `FIELD_RULE_VIOLATION` and `FIELD_WRITE_FORBIDDEN` name a core key,
 * `FIELD_SLOT_INPUT_INVALID` names `extensions.<moduleId>.<key>`, and a request
 * validation failure names a body path. A path lands on the field it is, or is
 * inside: `registeredAddress.city` on `registeredAddress`,
 * `extensions.acme.code.0` on the slot `acme.code`. A detail no field takes is
 * left to the host, which shows the envelope's message as it did before.
 *
 * `422 COMMAND_EXTENSION_UNCLAIMED` (`extensions.<moduleId>`) is the one
 * refusal that is not about a value: the module was switched off while the
 * form was open. Its modules are reported apart, for the form to drop their
 * fields and keep everything else staged.
 */
import { ApiError } from '../api-client.js';

export interface DeclaredFormErrorMapping {
  readonly code: string;
  /** Field key or slot wire key → the first message for it. */
  readonly fields: Readonly<Record<string, string>>;
  /** Modules no present hook claimed: switched off since the form loaded. */
  readonly unclaimedModules: readonly string[];
  /** Details no field of the form takes. */
  readonly unmapped: readonly { readonly path: string | undefined; readonly message: string }[];
}

interface Detail {
  readonly path?: unknown;
  readonly message?: unknown;
  readonly issue?: unknown;
}

const UNCLAIMED = 'COMMAND_EXTENSION_UNCLAIMED';

/** The field `path` names among `known`: itself, or the longest known key it is inside. */
function fieldOf(path: string, known: readonly string[]): string | null {
  let target = path;
  if (path.startsWith('extensions.')) {
    const [, moduleId, key] = path.split('.');
    if (moduleId === undefined || key === undefined) return null;
    target = `${moduleId}.${key}`;
    return known.includes(target) ? target : null;
  }
  let best: string | null = null;
  for (const key of known) {
    if ((target === key || target.startsWith(`${key}.`)) && (best === null || key.length > best.length)) best = key;
  }
  return best;
}

/**
 * The refusal `error` mapped onto `known` (core keys and slot wire keys), or
 * `null` when it is not an API refusal carrying `details[]`.
 */
export function mapDeclaredFormError(error: unknown, known: readonly string[]): DeclaredFormErrorMapping | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.envelope.error.details;
  if (!Array.isArray(details)) return null;
  const code = error.envelope.error.code;
  const fields: Record<string, string> = {};
  const unclaimed = new Set<string>();
  const unmapped: { path: string | undefined; message: string }[] = [];
  for (const raw of details as readonly Detail[]) {
    const path = typeof raw.path === 'string' ? raw.path : undefined;
    const message = typeof raw.message === 'string' ? raw.message : typeof raw.issue === 'string' ? raw.issue : error.envelope.error.message;
    if (code === UNCLAIMED && path !== undefined && /^extensions\.[a-z_][a-z0-9_]*$/u.test(path)) {
      unclaimed.add(path.slice('extensions.'.length));
      continue;
    }
    const field = path === undefined ? null : fieldOf(path, known);
    if (field === null) {
      unmapped.push({ path, message });
      continue;
    }
    fields[field] ??= message;
  }
  return { code, fields, unclaimedModules: [...unclaimed].sort(), unmapped };
}

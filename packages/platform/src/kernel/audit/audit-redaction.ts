import { AUDIT_ERASED_MARKER, isUuidShape } from '@endora-commerce/contracts';

/**
 * The redaction rule for an anonymised subject's audit snapshots (issue #844).
 *
 * One type-agnostic, shape-based allowlist: **keys are always kept** — a diff
 * still says which fields changed — and a value is kept only when one of the
 * rules below keeps it. Everything else becomes `AUDIT_ERASED_MARKER`. In order:
 *
 * | #   | Rule                                                                 | Kept? |
 * | --- | -------------------------------------------------------------------- | ----- |
 * | R0  | key `customFieldValues`, at any depth                                | keys kept, **every value erased** |
 * | R1  | `null`                                                               | kept |
 * | R2  | the marker                                                           | kept (idempotence) |
 * | R3  | a boolean                                                            | kept |
 * | R4  | key `id` or `…Id`, and a UUID-shaped value                           | kept |
 * | R5  | key `…Ids`, and every element UUID-shaped                            | kept |
 * | R6  | key `…At`, and an ISO-8601 date-time that parses                     | kept |
 * | R7  | a global code key or a caller's keep key, and a code value           | kept |
 * | R8  | key `…Keys`, and every element a code                                | kept |
 * | R9  | an object                                                            | recurse |
 * | R10 | an array matching nothing above                                      | recurse per element |
 * | R11 | anything else                                                        | the marker |
 *
 * A *code* is a string of 1–64 characters from `[A-Za-z0-9_.:-]`, or a finite
 * number, so free text under a code key ("Blocked by ops after …") is erased.
 *
 * **Fail closed**: a key a writer adds next year is erased unless somebody
 * allowlists it — in the owner's `*_AUDIT_KEEP_KEYS`, not here: the kernel names
 * no module's keys (D-37). **Idempotent**: `f(f(x))` is `f(x)`, which is what
 * lets a re-run find nothing to write.
 */

/** Keys whose code values every object type keeps. */
const GLOBAL_CODE_KEYS: ReadonlySet<string> = new Set([
  'status',
  'statusCode',
  'kind',
  'type',
  'source',
  'action',
  'version',
]);

const CODE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** `2026-11-07T10:15:30Z`, with optional seconds, fraction and offset. */
const ISO_DATE_TIME =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?$/;

export interface AuditRedactionPolicy {
  /** The owner's extra code keys for this object type. */
  readonly keepKeys: readonly string[];
}

/**
 * The redacted copy of one `stateBefore` / `stateAfter`. Never mutates its
 * input; `null` stays `null`.
 */
export function redactAuditState(
  state: Record<string, unknown> | null,
  policy: AuditRedactionPolicy,
): Record<string, unknown> | null {
  if (state === null) return null;
  const keep = new Set(policy.keepKeys);
  return redactObject(state, keep);
}

/** Whether `value` is the stored erased marker. */
export function isAuditErasedMarker(value: unknown): boolean {
  return value === AUDIT_ERASED_MARKER;
}

function redactObject(value: Record<string, unknown>, keep: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) out[key] = redactValue(key, child, keep);
  return out;
}

function redactValue(key: string | null, value: unknown, keep: ReadonlySet<string>): unknown {
  // R0 — every custom-field value, whatever its type, under its own key.
  if (key === 'customFieldValues') return eraseCustomFieldValues(value);
  // R1–R3
  if (value === null) return null;
  if (value === AUDIT_ERASED_MARKER) return value;
  if (typeof value === 'boolean') return value;
  if (key !== null) {
    // R4
    if ((key === 'id' || key.endsWith('Id')) && typeof value === 'string' && isUuidShape(value)) return value;
    // R5
    if (key.endsWith('Ids') && Array.isArray(value) && value.every((e) => typeof e === 'string' && isUuidShape(e))) {
      return [...value];
    }
    // R6
    if (key.endsWith('At') && typeof value === 'string' && isIsoDateTime(value)) return value;
    // R7
    if ((GLOBAL_CODE_KEYS.has(key) || keep.has(key)) && isCode(value)) return value;
    // R8
    if (key.endsWith('Keys') && Array.isArray(value) && value.every(isCode)) return [...value];
  }
  // R9
  if (isPlainObject(value)) return redactObject(value, keep);
  // R10 — an element is judged under the key that holds the list.
  if (Array.isArray(value)) return value.map((element) => redactValue(key, element, keep));
  // R11
  return AUDIT_ERASED_MARKER;
}

function eraseCustomFieldValues(value: unknown): unknown {
  if (value === null) return null;
  if (!isPlainObject(value)) return AUDIT_ERASED_MARKER;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = AUDIT_ERASED_MARKER;
  return out;
}

function isCode(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && CODE_TOKEN.test(value);
}

function isIsoDateTime(value: string): boolean {
  return ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

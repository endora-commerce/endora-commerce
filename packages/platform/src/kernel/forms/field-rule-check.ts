import {
  ERROR_CODES,
  evaluateFieldCondition,
  isEmptyFieldValue,
  type FieldCondition,
  type FieldRuleViolationDetail,
  type FieldWriteForbiddenDetail,
  type FieldWriteForbiddenReason,
} from '@endora-commerce/contracts';
import type { CommandActor } from '../../commands/command.js';
import type { FieldRuleCheck, FieldRuleCheckContext } from '../../commands/hooks/types.js';
import { HttpError } from '../../http/error-envelope.js';
import { localizableDetail } from '../../http/localizable-detail.js';
import type { AdminPermissionChecker } from '../ports/require-admin.js';
import { forbiddenReason } from './permissions.js';
import {
  FIELD_RULE_ERROR_MESSAGES,
  FIELD_RULE_MESSAGES_MODULE,
  FIELD_RULE_SENTENCES,
  FIELD_WRITE_FORBIDDEN_SENTENCES,
  fieldRuleKey,
  interpolate,
  writeForbiddenKey,
} from './messages.js';
import { mergeValidation, violationsOf, type FormatValidator, type RuleViolation, type ValidationContribution } from './rules.js';
import type { RuleContribution, SealedFieldSet, SealedWriter } from './seal.js';
import type { FieldProjection, FieldScopedProjection } from './types.js';

/**
 * The platform's field-rule check (`specs/193-admin-form-extensions/`
 * FR-041 – FR-045, FR-124, `contracts/field-rules.md` §5), one per writer
 * action. The bus runs it first in the action's `beforeCommit` phase
 * (`CommandHookRegistry.fieldRuleCheck`); it reads the hook data through the
 * owner's projection, writes nothing, and refuses by throwing, so the Command
 * rolls back with no audit entry and no outbox row.
 *
 * **Not retroactive (D-300.4, D-300.11).** On an update only the fields the
 * write set or cleared are held to a rule — tightened `required`, the bounds,
 * options, patterns and formats — so a record stored before a rule existed
 * stays editable in every other field; `requiredWhen` is also held when the
 * write changed a field its condition reads. A create holds every
 * field it sets. `writePermission` is likewise asked of changed fields only.
 */

export interface FieldRuleCheckDeps {
  /** Whether a module is effectively present, asked per Command (FR-052). */
  readonly isPresent: (moduleId: string) => boolean;
  /** `admin_roles`' checker; `undefined` fails a guarded write closed. */
  readonly permissionChecker: () => AdminPermissionChecker | undefined;
  readonly validateFormat: FormatValidator;
}

/** Whether `writer` writes `key` — a live key, or a member of a family it lists (`attributeValues.*`). */
function writesKey(writes: readonly string[], key: string): boolean {
  return writes.some((written) => written === key || (written.endsWith('.*') && key.startsWith(written.slice(0, -1))));
}

/** The field keys of `set` a writer of `writes` can be held to: a contribution, or the owner's writePermission. */
function guardedKeys(set: SealedFieldSet, writes: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const key of set.rules.keys()) if (writesKey(writes, key)) keys.add(key);
  for (const key of set.ownerWritePermissions.keys()) if (writesKey(writes, key)) keys.add(key);
  return [...keys].sort();
}

/**
 * D-300.3, D-300.10: a buyer's own storefront write is not bound. It is one
 * when a customer acts for itself, or when the Command (or one it runs below)
 * declared `buyerSelfService` and the actor has no acting admin and is
 * `system` (an anonymous storefront request) or `customer`. An admin, an API
 * key and an impersonating admin are bound whatever the flag says.
 */
function isBuyerSelfService(actor: CommandActor, flagged: boolean): boolean {
  if (actor.actorAdminUserId !== null) return false;
  if (actor.kind === 'customer') return true;
  return flagged && actor.kind === 'system';
}

/** The fields a condition reads: its leaves' `field`. */
function conditionFields(condition: FieldCondition): string[] {
  if ('all' in condition) return condition.all.flatMap(conditionFields);
  if ('any' in condition) return condition.any.flatMap(conditionFields);
  if ('not' in condition) return conditionFields(condition.not);
  return [condition.field];
}

function changedKeys(projection: FieldProjection, mode: 'create' | 'update'): ReadonlySet<string> {
  if ('changed' in projection) return new Set(projection.changed);
  const before = projection.before ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(projection.after)]);
  const changed = new Set<string>();
  for (const key of keys) {
    const was = Object.prototype.hasOwnProperty.call(before, key) ? before[key] : undefined;
    const is = Object.prototype.hasOwnProperty.call(projection.after, key) ? projection.after[key] : undefined;
    if (mode === 'create' && projection.before === null) {
      if (!isEmptyFieldValue(is)) changed.add(key);
    } else if (JSON.stringify(was) !== JSON.stringify(is)) {
      changed.add(key);
    }
  }
  return changed;
}

function valueOf(values: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
}

function ruleDetail(path: string, violation: RuleViolation): FieldRuleViolationDetail {
  const params = violation.params;
  const sentenceParams = params?.limit !== undefined ? { limit: params.limit } : params?.format !== undefined ? { format: params.format } : undefined;
  const entry: FieldRuleViolationDetail = {
    path,
    code: violation.code,
    ...(params === undefined ? {} : { params: { ...params } }),
    message: interpolate(FIELD_RULE_SENTENCES[violation.code], sentenceParams),
  };
  return localizableDetail(entry, {
    moduleId: violation.messageKey !== undefined ? violation.moduleId : FIELD_RULE_MESSAGES_MODULE,
    key: violation.messageKey ?? fieldRuleKey(violation.code),
    ...(sentenceParams === undefined ? {} : { params: sentenceParams }),
  });
}

export function forbiddenDetail(path: string, permission: string, reason: FieldWriteForbiddenReason): FieldWriteForbiddenDetail {
  return localizableDetail(
    { path, permission, reason, message: FIELD_WRITE_FORBIDDEN_SENTENCES[reason] },
    { moduleId: FIELD_RULE_MESSAGES_MODULE, key: writeForbiddenKey(reason) },
  );
}

interface Present {
  readonly validations: ValidationContribution[];
  readonly requiredWhen: RuleContribution['requiredWhen'][];
  readonly writePermission: string | undefined;
}

/** What is in force on `key` right now: the present contributions, and the owner's writePermission. */
function inForce(set: SealedFieldSet, key: string, isPresent: (moduleId: string) => boolean): Present | null {
  const contributions = (set.rules.get(key) ?? []).filter((contribution) => contribution.requires.every(isPresent));
  const ownerPermission = set.ownerWritePermissions.get(key);
  if (contributions.length === 0 && ownerPermission === undefined) return null;
  return {
    validations: contributions.flatMap((c) =>
      c.validation === undefined && c.wholeNumber !== true
        ? []
        : [{ moduleId: c.moduleId, ...(c.validation === undefined ? {} : { validation: c.validation }), ...(c.wholeNumber === true ? { wholeNumber: true as const } : {}) }],
    ),
    requiredWhen: contributions.flatMap((c) => (c.requiredWhen === undefined ? [] : [c.requiredWhen])),
    writePermission: ownerPermission ?? contributions.find((c) => c.writePermission !== undefined)?.writePermission,
  };
}

/**
 * The check for one action's writers, or `undefined` when no writer of it can
 * ever be held to a rule — then the bus does not ask for hook data at all.
 */
export function fieldRuleCheckFor(writers: readonly SealedWriter[], deps: FieldRuleCheckDeps): FieldRuleCheck | undefined {
  const plans = writers
    .map((sealed) => ({ ...sealed, keys: guardedKeys(sealed.set, sealed.writer.writes) }))
    .filter((plan) => plan.keys.length > 0);
  if (plans.length === 0) return undefined;

  return async (ctx: FieldRuleCheckContext): Promise<void> => {
    // Step 1 — one pass over presence; nothing in force, nothing projected.
    const live = plans
      .map((plan) => ({ plan, force: new Map(plan.keys.flatMap((key) => {
        const force = inForce(plan.set, key, deps.isPresent);
        return force === null ? [] : [[key, force] as const];
      })) }))
      .filter((entry) => entry.force.size > 0);
    if (live.length === 0) return;
    // Step 2 — D-300.3.
    if (isBuyerSelfService(ctx.actor, ctx.buyerSelfService)) return;

    const violations: FieldRuleViolationDetail[] = [];
    const forbidden: FieldWriteForbiddenDetail[] = [];
    const forbiddenSeen = new Set<string>();
    for (const { plan, force } of live) {
      const { writer, set } = plan;
      // Step 3 — the owner's projection.
      const projected = writer.project(ctx.data);
      const scopes: readonly FieldScopedProjection[] = writer.scoped === true
        ? (projected as readonly FieldScopedProjection[])
        : [{ ...(projected as FieldProjection), scope: null }];
      for (const projection of scopes) {
        const changed = changedKeys(projection, writer.mode);
        const after = projection.after;
        const isCreate = writer.mode === 'create';
        for (const [key, rules] of force) {
          // D-300.11 — a field is held only when the write set or cleared it,
          // and its `requiredWhen` also when the write changed a field the
          // condition reads.
          const touched = isCreate || changed.has(key);
          const conditions = rules.requiredWhen.filter(
            (condition): condition is FieldCondition =>
              condition !== undefined && (touched || conditionFields(condition).some((name) => changed.has(name))),
          );
          if (!touched && conditions.length === 0) continue;
          const field = set.field(key);
          if (field === undefined) continue;
          const merged = mergeValidation(rules.validations);
          const value = valueOf(after, key);
          // Step 4 — required binds the global value only (FR-124).
          const required = (touched && merged.required !== undefined) || conditions.some((condition) => evaluateFieldCondition(condition, after));
          if (required && projection.scope === null && isEmptyFieldValue(value)) {
            violations.push(ruleDetail(key, { moduleId: merged.required?.moduleId ?? FIELD_RULE_MESSAGES_MODULE, messageKey: merged.required?.messageKey, code: 'required' }));
          }
          if (!touched) continue;
          for (const violation of violationsOf(field.type, value, merged, deps.validateFormat)) {
            violations.push(ruleDetail(key, violation));
          }
          // Step 5 — changed fields only.
          if (rules.writePermission !== undefined && changed.has(key) && !forbiddenSeen.has(key)) {
            const reason = await forbiddenReason(ctx.actor, rules.writePermission, deps.permissionChecker);
            if (reason !== null) {
              forbiddenSeen.add(key);
              forbidden.push(forbiddenDetail(key, rules.writePermission, reason));
            }
          }
        }
      }
    }

    // Step 6 — 403 wins.
    if (forbidden.length > 0) {
      throw new HttpError(403, ERROR_CODES.FIELD_WRITE_FORBIDDEN, FIELD_RULE_ERROR_MESSAGES.FIELD_WRITE_FORBIDDEN, forbidden as unknown as Record<string, unknown>);
    }
    if (violations.length > 0) {
      throw new HttpError(422, ERROR_CODES.FIELD_RULE_VIOLATION, FIELD_RULE_ERROR_MESSAGES.FIELD_RULE_VIOLATION, violations as unknown as Record<string, unknown>);
    }
  };
}

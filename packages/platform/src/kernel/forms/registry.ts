import { createHash } from 'node:crypto';
import type { EffectiveFormsResponse, FormLayoutOverrideRow, FormLayoutOverrideSource } from '@endora-commerce/contracts';
import type { FieldRuleCheck, FieldRuleCheckSource } from '../../commands/hooks/types.js';
import type { AdminPermissionChecker } from '../ports/require-admin.js';
import { computeEffectiveForms } from './effective-forms.js';
import type { FormCompositionWarning } from './errors.js';
import { fieldRuleCheckFor } from './field-rule-check.js';
import { formatValidator } from './formats.js';
import { ambientPermissionChecker } from './permissions.js';
import { sealForms, type FormSealInput, type SealedForms } from './seal.js';
import type { FieldFormatRegistration, FieldSetRegistration } from './types.js';

/**
 * The form registry (`specs/193-admin-form-extensions/` WP-B): one per
 * composed application, shared by every `ModuleContext` (which registers
 * writers and formats into it), the Command Bus (which asks it for an
 * action's field-rule check, through the command-hook registry) and
 * `_lifecycle`'s `GET /api/v1/admin/effective-forms`.
 *
 * `composeModules` **seals** it after the command-hook registry, handing it
 * the declarations as data; every composition refusal is raised there
 * (`./seal.ts`). After it a registration throws, and the check and the
 * effective forms read a frozen model. Presence is not decided at the seal:
 * it is asked per Command and per memo key, so switching a module off needs
 * no restart (FR-052).
 */

export interface FormRegistryOptions {
  /** Whether a module is effectively present. Defaults to always (unit tests and bare harnesses). */
  readonly isPresent?: (moduleId: string) => boolean;
  /** A number that changes whenever presence does; part of the effective-forms memo key. */
  readonly presenceVersion?: () => number;
  /**
   * `admin_roles`' permission checker. Defaults to the one the current
   * platform scope resolves (`permissionService`), so a Command running in a
   * request asks the request's container; `undefined` fails a guarded write
   * closed.
   */
  readonly permissionChecker?: () => AdminPermissionChecker | undefined;
  /** The operator layer (`formLayoutOverrideSource`), when the composition has one. */
  readonly operatorLayer?: () => FormLayoutOverrideSource | undefined;
  readonly log?: { warn(object: Record<string, unknown>, message: string): void };
  /**
   * How long the memo may stand without a layout announcement (FR-097): the
   * bound on a lost subscription. Default 60 seconds, the operator layer's
   * own cache TTL.
   */
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export interface EffectiveForms {
  readonly response: EffectiveFormsResponse;
  /** A quoted digest of the response body. */
  readonly etag: string;
}

const EMPTY_SEALED: SealedForms = {
  fieldSets: new Map(),
  forms: [],
  writersByAction: new Map(),
  controls: new Map(),
  formats: new Map(),
  warnings: [],
};

export class FormRegistry implements FieldRuleCheckSource {
  readonly #options: FormRegistryOptions;
  readonly #writers: { moduleId: string; registration: FieldSetRegistration }[] = [];
  readonly #formats: ({ moduleId: string } & FieldFormatRegistration)[] = [];
  #sealed: SealedForms | undefined;
  #checks = new Map<string, FieldRuleCheck>();
  #validateFormat: (format: string, value: string) => boolean = formatValidator(new Map());
  #generation = 0;
  #memo: { key: string; at: number; value: Promise<EffectiveForms> } | undefined;

  constructor(options: FormRegistryOptions = {}) {
    this.#options = options;
  }

  get isSealed(): boolean {
    return this.#sealed !== undefined;
  }

  #refuseSealed(moduleId: string, what: string): void {
    if (this.#sealed !== undefined) {
      throw new Error(`[forms] the form registry is sealed — module '${moduleId}' tried to register ${what} after composition. Register from registerModule.`);
    }
  }

  /** Called by `ctx.fieldSets`, which stamps the module id. */
  registerFieldSets(moduleId: string, entries: readonly FieldSetRegistration[]): void {
    this.#refuseSealed(moduleId, 'a field set');
    for (const registration of entries) this.#writers.push({ moduleId, registration });
  }

  /** Called by `ctx.fieldFormats`, which stamps the module id. */
  registerFormats(moduleId: string, entries: readonly FieldFormatRegistration[]): void {
    this.#refuseSealed(moduleId, 'a field format');
    for (const entry of entries) this.#formats.push({ moduleId, id: entry.id, validate: entry.validate });
  }

  /**
   * Judge every declaration and registration against the composition, once.
   * Throws the first refusal; answers the warnings (deprecated targets), which
   * the composer logs.
   */
  seal(input: Omit<FormSealInput, 'writers' | 'formats'>): readonly FormCompositionWarning[] {
    if (this.#sealed !== undefined) throw new Error('[forms] the form registry is already sealed.');
    const sealed = sealForms({
      ...input,
      writers: this.#writers.map(({ moduleId, registration }) => ({ moduleId, set: registration.set, writers: registration.writers })),
      formats: this.#formats,
    });
    this.#validateFormat = formatValidator(sealed.formats);
    const deps = {
      isPresent: this.#options.isPresent ?? ((): boolean => true),
      permissionChecker: this.#options.permissionChecker ?? ambientPermissionChecker,
      validateFormat: this.#validateFormat,
    };
    const checks = new Map<string, FieldRuleCheck>();
    for (const [action, writers] of sealed.writersByAction) {
      const check = fieldRuleCheckFor(writers, deps);
      if (check !== undefined) checks.set(action, check);
    }
    this.#checks = checks;
    this.#sealed = sealed;
    return sealed.warnings;
  }

  /** {@link FieldRuleCheckSource}: one map lookup; `undefined` before the seal and for an action with no rule. */
  fieldRuleCheck(action: string): FieldRuleCheck | undefined {
    return this.#checks.get(action);
  }

  /** A platform or registered module format's validator; `false` for a format nobody validates. */
  validateFormat(format: string, value: string): boolean {
    return this.#validateFormat(format, value);
  }

  /** The operator layer changed (`b2b:form-layout:changed`): the next read recomputes. */
  bumpLayoutGeneration(): void {
    this.#generation += 1;
    this.#memo = undefined;
  }

  get layoutGeneration(): number {
    return this.#generation;
  }

  /**
   * `GET /api/v1/admin/effective-forms`' body: memoised per (presence snapshot, layout
   * generation), and for at most the TTL. Before the seal — a composition that
   * declares no forms has nothing to seal against — it is empty.
   */
  effectiveForms(): Promise<EffectiveForms> {
    const now = (this.#options.now ?? Date.now)();
    const key = `${this.#options.presenceVersion?.() ?? 0}:${this.#generation}`;
    const ttl = this.#options.ttlMs ?? 60_000;
    if (this.#memo !== undefined && this.#memo.key === key && now - this.#memo.at < ttl) return this.#memo.value;
    const value = this.#compute();
    this.#memo = { key, at: now, value };
    // A failed computation is not memoised: the next read tries again.
    value.catch(() => {
      if (this.#memo?.value === value) this.#memo = undefined;
    });
    return value;
  }

  async #compute(): Promise<EffectiveForms> {
    const sealed = this.#sealed ?? EMPTY_SEALED;
    const response = computeEffectiveForms(sealed, this.#options.isPresent ?? ((): boolean => true), await this.#operatorRows());
    const etag = `"${createHash('sha256').update(JSON.stringify(response)).digest('base64url')}"`;
    return { response, etag };
  }

  /**
   * The operator rows, or none. Presentation only (FR-100), so a layer that
   * cannot be read degrades the forms to code and core rather than failing
   * every admin screen — `operator-form-layout.md` §4's fail-open.
   */
  async #operatorRows(): Promise<readonly FormLayoutOverrideRow[]> {
    if (this.#sealed === undefined || this.#sealed.forms.length === 0) return [];
    let source: FormLayoutOverrideSource | undefined;
    try {
      source = this.#options.operatorLayer?.();
      return source === undefined ? [] : await source.listAll();
    } catch (error) {
      this.#options.log?.warn({ err: error }, '[forms] the operator form layout could not be read; serving code and core');
      return [];
    }
  }
}

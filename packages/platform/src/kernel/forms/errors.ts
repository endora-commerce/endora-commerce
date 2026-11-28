/**
 * Composition refusals of the form registry (`specs/193-admin-form-extensions/`
 * FR-021, `contracts/field-overrides.md` §3, `form-field-declaration.md` §2 –
 * §3, `field-rules.md` §2, `input-controls.md` §2 – §3). Each names the module,
 * the field set, the field and the remedy, and is thrown before the first boot
 * hook.
 */

/** Every code {@link FormCompositionError} is raised with. */
export const FORM_COMPOSITION_CODES = [
  // Owner side.
  'duplicate-field-set',
  'duplicate-form',
  'unknown-field-set',
  'form-owner-not-a-dependency',
  'foreign-field-set-registration',
  'duplicate-field-set-registration',
  'writer-not-hookable',
  'rule-check-only-writer-hookable',
  'accepts-unenforceable',
  // Both sides.
  'unknown-field',
  'unknown-permission',
  // Overrides.
  'unknown-form',
  'unknown-section',
  'override-not-accepted',
  'hidden-required-field',
  'default-on-hidden',
  'default-type-mismatch',
  'required-not-fillable',
  'override-loosens-rule',
  'override-contradiction',
  /** A merged tightening rejects a value the owner declares its system paths write (`systemValues`, D-300.31). */
  'rule-excludes-system-value',
  'override-conflict',
  'control-type-mismatch',
  /** An override's `validation.format` names a format other than its control's own (FR-033). */
  'control-format-conflict',
  'unknown-control',
  'format-without-validator',
  'condition-foreign-field',
  'foreign-override',
  'override-owner-not-a-dependency',
  'package-form-override-not-granted',
  'invalid-form-override-grant',
  // Formats.
  'foreign-field-format',
  'duplicate-field-format',
] as const;
export type FormCompositionCode = (typeof FORM_COMPOSITION_CODES)[number];

/** What a refusal is about: the declaring module, and the field set and field when there is one. */
export interface FormCompositionSubject {
  readonly moduleId: string;
  readonly fieldSet?: string | undefined;
  readonly field?: string | undefined;
}

export class FormCompositionError extends Error {
  readonly code: FormCompositionCode;
  readonly moduleId: string;
  readonly fieldSet: string | undefined;
  readonly field: string | undefined;
  readonly remedy: string;

  constructor(code: FormCompositionCode, subject: FormCompositionSubject, problem: string, remedy: string) {
    const where = [
      `module '${subject.moduleId}'`,
      ...(subject.fieldSet === undefined ? [] : [`field set '${subject.fieldSet}'`]),
      ...(subject.field === undefined ? [] : [`field '${subject.field}'`]),
    ].join(', ');
    super(`[forms] ${code}: ${problem} (${where}). ${remedy}`);
    this.name = 'FormCompositionError';
    this.code = code;
    this.moduleId = subject.moduleId;
    this.fieldSet = subject.fieldSet;
    this.field = subject.field;
    this.remedy = remedy;
  }
}

/**
 * An installed package (origin `package`) overrides a field of a field set it
 * holds no grant for (D-300.2, FR-051). A grant is the deployment's decision,
 * so the remedy is in the deployment's `divergence.ts`.
 */
export class PackageFormOverrideNotGrantedError extends FormCompositionError {
  constructor(moduleId: string, fieldSet: string, field: string) {
    super(
      'package-form-override-not-granted',
      { moduleId, fieldSet, field },
      `the installed package overrides a field of '${fieldSet}', and the deployment grants it no override on that field set`,
      `Grant it in the deployment's divergence.ts — formOverrideGrants: { '${fieldSet}': [{ moduleId: '${moduleId}', ` +
        "packageName: '<installed package name>', reason: '…' }] } — or remove the override from the package.",
    );
    this.name = 'PackageFormOverrideNotGrantedError';
  }
}

/** Why a `formOverrideGrants` entry is refused (`field-overrides.md` §4, 189 `module-origin.md` §5). */
export type FormOverrideGrantIssue = 'unknown-field-set' | 'unknown-module' | 'not-a-package' | 'package-name-mismatch' | 'unused';

const GRANT_REMEDIES: Readonly<Record<FormOverrideGrantIssue, string>> = {
  'unknown-field-set': 'Name a field set some composed module declares, or remove the grant.',
  'unknown-module': 'Name a module this deployment composes, or remove the grant.',
  'not-a-package':
    'A grant is for an installed package only: a deployment module may override within accepts without one, and a core module may not override another module’s field set.',
  'package-name-mismatch': 'Write the name in the installed package’s own package.json; a grant matches on the module id and the package name.',
  unused: 'Remove the grant: no override of that package targets the field set, and a stale grant would admit the next one silently.',
};

export class InvalidFormOverrideGrantError extends FormCompositionError {
  readonly issue: FormOverrideGrantIssue;

  constructor(issue: FormOverrideGrantIssue, moduleId: string, fieldSet: string, problem: string) {
    super('invalid-form-override-grant', { moduleId, fieldSet }, `the deployment's formOverrideGrants entry is refused (${issue}): ${problem}`, GRANT_REMEDIES[issue]);
    this.name = 'InvalidFormOverrideGrantError';
    this.issue = issue;
  }
}

/** A non-fatal finding of the seal: logged, and listed by the divergence report as `deprecated`. */
export interface FormCompositionWarning {
  readonly code: 'deprecated-target';
  readonly moduleId: string;
  readonly fieldSet: string;
  readonly field: string;
  readonly message: string;
}

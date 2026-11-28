/**
 * Declared forms, the data half (`specs/193-admin-form-extensions/` WP-C): the
 * effective-forms provider, the layout feed of the contracts' `formLayout`, the
 * client rules, the submission split and the error mapping. The React half is
 * `components/declared-form/`.
 */
export {
  EffectiveFormsProvider,
  getEffectiveForms,
  useEffectiveForm,
  useEffectiveForms,
} from './EffectiveFormsProvider.js';
export type {
  EffectiveFormsContextValue,
  EffectiveFormsProviderProps,
  EffectiveFormsStatus,
} from './EffectiveFormsProvider.js';
export { declaredFormLayout, declaredFormSections } from './layout.js';
export type { DeclaredFormLayoutInput, EffectiveForm } from './layout.js';
export { checkPlatformFieldFormat } from './formats.js';
export { clientFieldViolations, fieldValueChanged, isEffectivelyRequired } from './rules.js';
export type { ClientFieldViolation, ClientFieldViolationsInput } from './rules.js';
export { declaredFormSubmission } from './submission.js';
export type {
  DeclaredFormSubmission,
  DeclaredFormSubmissionInput,
  SubmissionFieldState,
  SubmissionSlot,
} from './submission.js';
export { mapDeclaredFormError } from './errors.js';
export type { DeclaredFormErrorMapping } from './errors.js';

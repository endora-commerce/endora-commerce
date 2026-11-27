---
'@endora-commerce/contracts': minor
---

**Admin form extensions: the contracts** (issue #2006, `specs/193-admin-form-extensions/` WP-A, ruling D-300). Additive; no existing manifest, contribution or declaration changes.

- `defineFieldSet` and `defineAdminForm` declare a host entity's field set and the admin forms laid out over it, keeping field and section keys as literal types (`FieldKeyOf`, `SectionKeyOf`). Each validates against its Zod twin (`FieldSetDeclarationSchema`, `AdminFormDeclarationSchema`) and throws naming the rule: `duplicate-field-key`, `options-type-mismatch`, `accepts-hidden-on-required`, `accepts-control-on-composite`, `duplicate-form-key`.
- Vocabularies: `FIELD_VALUE_TYPES`, `FIELD_OVERRIDE_KINDS` (with `PRESENTATION_OVERRIDES` and `SERVER_ENFORCED_OVERRIDES`), `OPERATOR_KINDS`, `FIELD_RULE_CODES`, `FIELD_FORMATS` and `PLATFORM_INPUT_CONTROLS`.
- `FieldConditionSchema` (depth at most 4, at most 16 leaves) and `evaluateFieldCondition`, the one pure evaluator the admin form and the server both call. Shared test vectors are published as `@endora-commerce/contracts/admin-forms.vectors`.
- `FieldOverrideSchema`, `FieldValidationTighteningSchema`, `fieldOverrideKinds`, `InputControlDeclarationSchema`, `FieldRuleViolationDetailSchema`, and the effective-forms response (`EffectiveFormsResponseSchema`, `EffectiveFieldSchema`, `EffectiveTextSchema`).
- `ModuleManifestSchema` accepts four optional fields: `fieldSets`, `adminForms`, `formOverrides` (at most 200) and `inputControls`. `defineModuleManifest` refuses a field set whose `ownerModuleId` is not the manifest's id, one field set or form declared twice (`duplicate-field-set`, `duplicate-form`), and an input control outside `<moduleId>.` or declared twice.
- `AdminContributions` gains optional `fields` (slot fields, `AdminFieldContributionSchema`), `controls` and `fieldBehaviours`.
- `DeploymentDivergenceDeclarationSchema` accepts an optional `formOverrideGrants: { [fieldSetId]: [{ moduleId, packageName, reason }] }`.
- `FormLayoutOverrideSource` and `FormLayoutOverrideRow`, the operator layer `custom_fields` will provide as `formLayoutOverrideSource`, and `FORM_LAYOUT_CHANGED_CHANNEL` (`b2b:form-layout:changed`). The interface becomes a published port when its provider registers it.

Nothing reads the new fields yet; the platform, the CLI and the admin kit follow.

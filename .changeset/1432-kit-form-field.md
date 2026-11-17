---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': minor
---

`@endora-commerce/admin-kit/ui` publishes `FormField` and `HelpTip` (issue #1432).

`FormField` renders a label, its control, a one-line hint and an error, and wires them together: it generates the control's `id`, points the `<label>` at it, links the error, hint and description through `aria-describedby`, marks the control `aria-invalid` when there is an error and `aria-required` when the field is `required`. The child is cloned with that wiring — `Input`, `Select`, `Textarea`, `Checkbox`, or any component that forwards `id` and `aria-*` — or, for a control that needs it elsewhere, the child is a function receiving it as `FormFieldControlProps`:

```tsx
<FormField label={t('field.email')} hint={t('field.emailHint')} error={errors.email} required>
  <Input type="email" value={email} onChange={onEmail} />
</FormField>
```

`group` labels a composite control (`role="group"` named by the label); `help` puts a longer explanation behind a `HelpTip` beside the label; `description`, `labelAddon`, `action` and `describedBy` cover editor rows that carry more than a label. `HelpTip` is the ⓘ disclosure on its own, for a page header or a table column.

`core` gains `common.formField.required` and `common.helpTip.label`, in English and Polish.

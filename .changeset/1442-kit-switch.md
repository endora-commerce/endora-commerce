---
'@endora-commerce/admin-kit': minor
---

`@endora-commerce/admin-kit/ui` publishes `Switch` and `SettingRow` (issue #1442), and `FormField` gains `layout`.

`Switch` is the kit's on/off control: a native `<button type="button" role="switch" aria-checked>`, always controlled through `checked` and `onCheckedChange(next)`. `disabled` is the native attribute; `disabledReason` keeps the switch focusable, marks it `aria-disabled`, ignores presses and describes it with the reason; `busy` marks an immediate write in flight (`aria-busy`) and ignores presses until it is cleared. On a coarse pointer its hit area is 44 × 44 px.

`SettingRow` is the settings-list layout — label, description, hint and error on the left, the control on the right — and is `FormField` with the new `layout="row"`; `layout` defaults to `"stack"`, so every existing `FormField` renders as before.

```tsx
<SettingRow label={t('settings.listPrice.label')} description={t('settings.listPrice.help')}>
  <Switch checked={value} onCheckedChange={setValue} />
</SettingRow>
```

Use a `Switch` for every boolean setting and every toggle that takes effect immediately; in a form saved later, only where the label describes a state — otherwise keep a `Checkbox`.

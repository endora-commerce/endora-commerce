---
'@endora-commerce/admin-kit': minor
---

`@endora-commerce/admin-kit/ui` publishes `InlineStatus` and `useInlineStatus` (issue #1443), and `Alert`'s ARIA role now follows its variant (issue #1484).

`InlineStatus` is the result of an action shown next to the button that produced it: a `role="status"` polite live region that is mounted, empty, from the first render, so its message is announced. `useInlineStatus()` holds its state — `show(message, tone?)` after the action, `clear()` on the next edit — and re-announces a repeated message. `tone` is `success`, `error` or `info`; `visuallyHidden` announces without showing.

```tsx
const status = useInlineStatus();
<Button onClick={save}>{t('common.save')}</Button>
<InlineStatus {...status.props} />
```

`Alert` used to render `role="alert"` for every variant, so every success, warning and static notice interrupted the screen reader. It is now `role="alert"` only for `destructive`, `role="status"` for `success`, and has no live role for `default` and `warning`. The new `live` prop chooses explicitly — `'assertive'`, `'polite'` or `'off'` — and an explicit `role` still wins. **A warning or default banner that has to be announced must now pass `live`.** `ALERT_DEFAULT_LIVE` and `alertRole(variant, live)` expose the mapping, and every `Alert` carries `data-slot="alert"` and `data-variant` so a test can find a banner without a role. Success and warning colours come from the `--success-soft` and `--warn-soft` theme tokens instead of a fixed palette. `SaveSessionSummary` and `StatusChangeControl` announce through `InlineStatus`.

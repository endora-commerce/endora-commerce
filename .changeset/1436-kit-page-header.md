---
'@endora-commerce/admin-kit': minor
---

`PageHeader` in `@endora-commerce/admin-kit/ui` gains `help`, and its `description` is one line (issue #1436).

- `description` stays optional and is now clamped to one line (`line-clamp-1`). Give one only when it says something the screen does not show; longer text belongs in `help`.
- `help` renders a `HelpTip` (ⓘ) beside the title, named after it ("More information: <title>"), outside the `h1`.
- `back` accepts an optional `onClick`, which runs before the navigation; `event.preventDefault()` holds it, so an editor can ask about unsaved changes first.

**Removed from `theme.css`:** the `.b2b-page-head`, `.b2b-page-head__back`, `.b2b-page-head__title`, `.b2b-page-head__sub` and `.b2b-page-head__actions` classes, including their mobile rules and the `.b2b-page-head__actions.b2b-sticky-form-actions` button grid. A module that renders them gets unstyled markup and no `h1`. Replace the markup with `PageHeader`:

```tsx
// before
<div className="b2b-page-head">
  <div className="b2b-grow">
    <div className="b2b-page-head__title">{t('page.title')}</div>
    <div className="b2b-page-head__sub">{t('page.description')}</div>
  </div>
  <div className="b2b-page-head__actions">{actions}</div>
</div>

// after
<PageHeader title={t('page.title')} description={t('page.description')} actions={actions} />
```

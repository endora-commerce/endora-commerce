---
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-document-templates': patch
'@endora-commerce/mod-transactional-emails': patch
---

The Page Builder has one canvas toolbar (issue #1494, UX audit CONTENT-11). `PageBuilderHeaderActions` now draws the module's own actions (`extraActions`, such as Translate or Preview email), a labelled **More** menu and Fullscreen. Save as template, Apply template, Copy from language and Clear canvas are entries of that menu. Clear canvas is the last entry, after a separator, in the destructive colour, and still asks before it clears. An entry that cannot run says why under its label.

**Breaking for consumers of `@endora-commerce/page-builder-admin`:** `PageBuilderTemplateActions` and `PageBuilderHeaderShell` are removed. Pass their props to `PageBuilderHeaderActions` instead and drop the Puck `header` override:

```tsx
// before
header: ({ children }) => (
  <PageBuilderHeaderShell leading={<PageBuilderTemplateActions currentData={data} onSaveAsTemplate={save} onListTemplatesForApply={list} onApplyTemplate={apply} t={t} />}>
    {children}
  </PageBuilderHeaderShell>
),
headerActions: () => <PageBuilderHeaderActions fullscreen={fs} onToggleFullscreen={toggle} currentData={data} t={t} />,

// after
headerActions: () => (
  <PageBuilderHeaderActions
    fullscreen={fs}
    onToggleFullscreen={toggle}
    currentData={data}
    onSaveAsTemplate={save}
    onListTemplatesForApply={list}
    onApplyTemplate={apply}
    t={t}
  />
),
```

The `.cms-pb-header-shell`, `.cms-pb-header-left` and `.cms-pb-header-leading` rules are removed from the admin kit's `theme.css`. The CMS, blog, megamenu and document-template editors show Back as the page header's back link above the title instead of a button beside Save. The `core` bundle gains `pageBuilder.clearCanvas.alreadyEmpty` in English and Polish.

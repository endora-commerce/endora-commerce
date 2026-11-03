# Contract: the `forms.Form` block — declaration, props, data, rendering

## §1 Declaration (`packages/modules/forms/src/manifest.ts`)

```ts
blocks: [{
  name: 'forms.Form',
  labelKey: 'blocks.form.label',
  descriptionKey: 'blocks.form.description',
  category: 'forms',
  contexts: ['cms'],
  translatable: [],            // the block holds no prose (FR-003)
  fields: {},
  responsiveFields: [],
  weight: 1,
}],
blockCategories: [{ key: 'forms', titleKey: 'blocks.category.forms', contexts: ['cms'], weight: 70 }],
```

`check:block-names`: declared once (`forms`), rendered by `cms-components`' default config; the
category is merged by key with `cms`' and `newsletter`'s, same `weight`/`visible` (or
`category-presentation-disagreement`). While `forms` **or** `cms` is absent the block is neither
offered nor rendered (descriptor filtered by owner presence; the storefront's presence step turns a
stored node into `makeMissingComponentConfig`, which renders nothing on the storefront and a note in
the editor — US10-1/2).

## §2 Props (`packages/cms-components/src/schema/component-types.ts`, `FormBlockProps`)

| Prop | Values | Default |
| --- | --- | --- |
| `formId` | uuid \| `''` | `''` |
| `fieldLook` | `boxed` \| `underline` \| `pill` | `boxed` |
| `size` | `s` \| `m` \| `l` | `m` |
| `buttonLook` | the existing button-look object (`BUTTON_SPEC_OBJECT_FIELDS`) | the theme's primary look |
| `align` | `start` \| `center` | `start` |
| `showTitle` | boolean | `true` |
| `showDescription` | boolean | `true` |

No pixel, colour, text, field or recipient prop exists (FR-003, FR-005); the block inherits the
section's colour scheme through the scheme tokens. `option-parity.test.ts` covers the editor/
storefront agreement.

## §3 Block data (`packages/cms-components/src/utils/block-data.ts`)

- New request kind `{ kind: 'form'; formId: string }`, declared by `formBlockDataRequest(props)`
  (`null` while `formId` is empty), owner `blockDataOwnerOf → 'forms'` (the return type widens to
  `'catalog' | 'blog' | 'forms'`).
- New `BlockDataSource.fetchForm?(formId): Promise<PublicFormDefinition>`; absent → `form` requests
  skipped; owner absent → skipped (block renders nothing).
- `BlockDataValue` widens with `PublicFormDefinition`.
- Storefront source: `storefront/lib/api/forms.ts` `getPublicForm(formId, ctx)` → `apiGet` with
  `next: { revalidate: 60, tags: [FORMS_STOREFRONT_CACHE_TAGS.form(formId)] }`, anonymous (the
  definition is viewer-independent; `signedInOnly` is decided by the renderer with the viewer).
- Editor source: `AdminCatalogPreviewProvider` gains `fetchForm` →
  `GET /api/v1/admin/forms/:id/preview?source=published` (falls back to `source=working` for a draft,
  so the canvas can show the "draft" note with the form's name); a 403 yields the "no permission to
  view forms" note.

## §4 Render context additions (`packages/cms-components/src/components/render-context.tsx`)

```ts
interface CmsFormsText {            // built-in storefront strings (storefront/lib/i18n/messages/forms.ts)
  submit: string; required: string; optional: string; errorSummary: string; errorSummaryCount: string;
  accepted: string; unavailable: string; rateLimited: string; tooLarge: string; captchaFailed: string;
  captchaUnavailable: string; needsJavaScript: string; truncatedAnswers: string;
  closed: string; notYetOpen: string; full: string; signIn: string; signInLink: string;
  selectPlaceholder: string; countryPlaceholder: string;
  fieldErrors: Record<FormFieldErrorCode, string>;
  addressParts: Record<'street' | 'line2' | 'postalCode' | 'city' | 'country', string>;
}
interface CmsFormsContext {
  text: CmsFormsText;
  countries: readonly { code: string; label: string }[];   // DictionaryProvider's, page language
  viewerSignedIn: boolean;
  signInPath: string;                                      // login path with returnTo
  pageContext: { pageUrl: string; pageTitle: string; referrer: string; query: Readonly<Record<string, string>> };
  attempt: { blockId: string; errors: { fieldKey: string; code: string; message: string }[];
             answers: Record<string, string | string[]>; truncated: boolean } | null;   // research R-10
}
// CmsRenderContextValue gains `forms?: CmsFormsContext`
```

`storefront/components/CmsPageRenderer.tsx` fills it (one prop, the 169 pattern) from
`storefront/lib/page-builder/forms-context.ts`, which reads the dictionary, the session, the request
`Referer`, the page title and — only when `?formsAttempt=` matches — the `forms_attempt` cookie.

## §5 Renderer behaviour (`packages/cms-components/src/components/forms/FormBlock.tsx`)

- Synchronous, `'use client'` boundary-compatible (`specs/141-module-block-renderers/` R2.2): data
  from block data and render context only; effects only for the CAPTCHA script and focus.
- `availability !== 'open'` → the matching message (closed / not yet open / full), or nothing for
  `unavailable` (draft/deleted, US2-3). `signedInOnly && !viewerSignedIn` → sign-in prompt with
  `signInPath` (US6-7).
- Open: `<form method="post" action={localizePath('/forms/submit')} noValidate>` with hidden `formId`,
  `blockId` (Puck `props.id`), `returnTo`, `anchor`, `hp_extra`, the hidden fields' values from
  `pageContext` or their static value; sections in a CSS grid of `columns`, fields spanning `width`,
  one column below the narrow breakpoint (FR-016).
- Visibility: initial state from `visibleElements(definition, defaults)`; hidden elements render with
  `hidden` plus the `<noscript><style>` reveal (research R-28); state re-evaluated on input.
- JS submit: `fetch` with `Accept: application/json`; on `invalid` show the server's errors in the
  summary and inline, focus the summary then the first invalid field; on success apply the
  confirmation (message inline; `redirect`/`page` → `window.location.assign`).
- Outcome addressing: `location.query.formsBlock === props.id` only (US2-7); `attempt` only when its
  `blockId` matches.
- CAPTCHA: when `captcha` is set, load `https://challenges.cloudflare.com/turnstile/v0/api.js` or
  `https://js.hcaptcha.com/1/api.js` once per page in an effect and render the provider's container;
  `<noscript>` shows `needsJavaScript` (OQ-2).
- Looks: classes `cmsc-pb-form`, `cmsc-pb-form--look-<boxed|underline|pill>`,
  `cmsc-pb-form--size-<s|m|l>`, `cmsc-pb-form--align-<start|center>`; button through `ButtonView`;
  scheme tokens only (`styles.test.ts`).
- Rich texts through `sanitizeRichHtml` only.

## §6 Editor

- `packages/page-builder-admin/src/chrome/FormPickers.tsx`: `createFormPickerField()` — lists
  `GET /api/v1/admin/forms?pageSize=100` (name + status badge), refetches on window focus, "Create a
  new form" opens `/forms/new` in a new tab, keeps an unknown stored id ("form not found" + pick
  another), on 403 shows the explanatory note (FR-004).
- `packages/modules/cms/src/admin/components/FormBlockFields.tsx` swaps the picker and the preset
  selects into `forms.Form` (the `NewsletterSignupFields.tsx` pattern), one loop line in
  `PageBuilderEditor.tsx`.
- Canvas notes (US2-3): draft → "This form is a draft and is not shown to shoppers"; closed → its
  closed message plus a note; deleted/unknown → "Form not found"; no permission → "You cannot view
  forms"; module off → the missing-block note.

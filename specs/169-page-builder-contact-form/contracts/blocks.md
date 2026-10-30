# Contract: block props and fields (feature 169)

The TypeScript shapes are in [../data-model.md](../data-model.md). This file fixes, per block, the
**Zod-level validity rules a renderer applies when it reads stored props** (a renderer never throws
on stored data: an invalid value reads as unset), the editor fields and their order (content →
layout → style → spacing → visibility, feature 163's rule), and what each field's visibility
depends on. Field objects are module-level constants; `resolveFields` returns cached objects only
(feature 163 R17 — a recreated field loses its input's focus). Booleans are switches
(`createToggleField`).

Notation: `oneOf(a, b)` = a value outside the list reads as unset.

---

## 1. `cms.Accordion` (WP-A)

| Field | Read rule | Editor | Shown when |
| --- | --- | --- | --- |
| `itemStyle` | `oneOf('plain','boxed','filled')` | select Plain / Boxed / **Filled** | always (existing) |

`dividers`, `dividerPosition`: hidden when `itemStyle` is `boxed` **or `filled`**.

## 2. `cms.DownloadTile` (WP-A)

| Field | Read rule | Editor | Shown when |
| --- | --- | --- | --- |
| `iconButtonSize` | `oneOf('s','m','l')` | select Small / Medium / Large | `linkLook === 'icon'` |
| `iconButtonStyle` | `oneOf('outline','filled')` | select Outline / Filled | `linkLook === 'icon'` |

Both join `ICON_BUTTON_KEYS`; placed after `iconButtonIcon`.

## 3. `cms.PageNavigation` (WP-B, new; owner `cms`, category `interactive`)

Read rules:

```ts
items: z.array(z.object({
  label: z.string().trim().min(1).max(80),
  anchor: z.string().regex(SECTION_ANCHOR_RE),
})).max(20)            // invalid items are skipped, not the block
label: z.string().trim().max(120).optional()
look: oneOf('pill', 'underline')            // unset: 'pill'
sticky: z.boolean().optional()             // unset: false
align: oneOf('start','center','end') | ResponsiveProp<…>   // unset: 'start'
```

Fields (order): `items` (array: `label` text, `anchor` — admin: anchor picker from the page's
anchors + free text, `page-builder-admin`'s `AnchorControl`; package default: text) → `label`
(text, "Accessible name") → `look` → `align` → `sticky` → margin / padding / border → hide on.

Default props on insert: two items `{ label: 'Section 1', anchor: '' }`, `{ label: 'Section 2',
anchor: '' }`, `look: 'pill'`. With no valid item the storefront renders nothing and the editor
shows a note.

## 4. `cms.ContactForm` (WP-C, new; owner `cms`, category `forms`)

Read rules:

```ts
const fieldConfig = z.object({
  show: z.boolean().optional(),
  label: z.string().trim().max(120).optional(),
  placeholder: z.string().trim().max(120).optional(),
  required: z.boolean().optional(),
  span: oneOf('half', 'full'),
});
fields.choice.options: z.array(z.object({ label: z.string().trim().min(1).max(200) })).max(30)
privacyConsent.label / marketingConsent.label: InlineRichText | string   // as newsletter.Signup's consentLabel
marketingConsent.show: z.boolean().optional()
columns: oneOf(1, 2)                         // unset: 1
fieldLook: oneOf('boxed', 'underline', 'pill') // unset: 'boxed'
labelPosition: oneOf('above', 'hidden')      // unset: 'above'
button: ButtonSpec without link — label ≤ 80; style/fill/size/icon/iconPosition as `cms.Button`
buttonAlign: oneOf('start','center','end','stretch') // unset: 'start'
messages.{success,error,unavailable}: z.string().trim().max(400).optional()
formLabel: z.string().trim().max(120).optional()
```

`email` and `message`: `show` and `required` are ignored (always on); `choice` with no valid option
is not rendered.

Fields (order):

1. *Content*: `fields` (object per field: `show` switch [not for email/message], `label`,
   `placeholder`, `required` switch [not for email/message], choice `options` array) →
   `privacyConsent.label` (inline rich text field) → `marketingConsent` (`show` switch, `label`) →
   `messages` (success, error, unavailable) → `formLabel`.
2. *Layout*: `columns` → per-field `span` (shown only with `columns: 2`) → `labelPosition` →
   `buttonAlign`.
3. *Style*: `fieldLook` → `button` (`BUTTON_SPEC_OBJECT_FIELDS` minus `link`).
4. *Spacing*: margin / padding / border. 5. *Visibility*: hide on.

Hidden-when rules: a field's `label`, `placeholder`, `required`, `span` are hidden while its `show`
is off; `span` hidden with `columns: 1`; `marketingConsent.label` hidden while its `show` is off.

Rendering rules:

- `required` fields carry `required` and `aria-required`; the label shows a marker whose accessible
  text is the catalogue's `cms.contactForm.required`.
- Inputs: `type="email"` + `autocomplete="email"` for email, `type="tel"` + `autocomplete="tel"`
  for phone, `autocomplete="name"`, `autocomplete="organization"`; message is a `<textarea
  rows="6">`; choice is a `<select>` whose first option is the placeholder (empty value).
- Errors (JS): each invalid field gets `aria-invalid="true"` and `aria-describedby` to its message;
  focus moves to the first invalid field. The outcome region is `role="status"`.
- Field looks use scheme tokens only: border `var(--cmsb-border, #d9e0e7)`, text
  `var(--cmsb-fg, #15202b)`, background `var(--cmsb-bg, #fff)`; `pill` = 999 px radius (textarea
  keeps 16 px); `underline` = bottom border only.
- The submit button renders `<button type="submit">` with the `cmsc-btn` classes of `ButtonView`
  (WP-C adds a `submit` rendering to `ButtonView` — additive).
- Outcome from the URL (`?contact=…&form=<this block's id>`) is in the server HTML (no-JS).

Editor canvas: a note under the form says the recipients are configured per sales channel in
Settings → Contact form; a warning shows while the privacy consent label is unset.

## 5. `newsletter.Signup` (WP-D)

| Field | Read rule | Editor | Shown when |
| --- | --- | --- | --- |
| `topics[].tagCode` | unchanged (`^[a-z0-9_-]{1,64}$`) | admin: tag picker (name list, stored code kept, text fallback) | always |
| `attributes` | `z.array(attribute).max(10)`; an item with an invalid key or type is skipped | array; item title = label or key | always |
| `attributes[].key` + `type` + `fieldLabel` | key `^[a-z][a-z0-9_]{0,63}$`, type `oneOf('text','number','boolean','date')` | admin: custom-field picker writing all three; package default: key text + type select | — |
| `attributes[].label` | `≤ 120` | text | — |
| `attributes[].placeholder` | `≤ 120` | text | `type !== 'boolean'` |
| `attributes[].required` | boolean | switch | — |
| `messages.fields` | `≤ 400` | text (in the existing `messages` object) | `attributes` not empty |

Rendering: boolean → `<input type="checkbox" name="attr.<key>">`; number → `type="number"`; date
→ `type="date"`; text → `type="text"` (`maxlength="500"`). Plus one hidden `attrSpec` per
attribute. With `attributes` unset or empty the markup is today's.

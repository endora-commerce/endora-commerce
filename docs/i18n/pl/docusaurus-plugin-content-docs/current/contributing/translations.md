---
sidebar_label: Admin UI Translations
# check-language: allow-non-english — this page *is* the EN→PL glossary, so the
# Polish column is its content, not untranslated prose. Kept in the YAML front
# matter so it never reaches the rendered page in either Markdown or MDX mode.
---

# Admin UI Translations

This page covers **Admin UI** string bundles only (`packages/modules/*/i18n/`).
The **documentation site** (`docs/`) uses a separate manual bilingual workflow
— cache entries, materialised markdown under `docs/i18n/pl/`, and
`check:docs-translations`. See
[Documentation site i18n](./documentation-i18n.md).

The Admin UI is bilingual at launch — every user-visible string is shipped in
both **English** (the platform-wide source of truth) and **Polish**. The
mechanism is a set of filesystem bundles per module, the lifecycle
reconciler that loads them, the in-process resolver and the language picker.
This page is the source of truth for the in-house Polish glossary and the
workflow for adding new strings without regressing coverage.

## Polish glossary

Use the canonical Polish rendering of every recurring B2B-commerce term on
every screen. Consistency beats local cleverness — when in doubt, look here
first and only propose a glossary edit if the term genuinely does not fit.

| English term            | Polish term                | Notes                                              |
|-------------------------|----------------------------|----------------------------------------------------|
| sales channel           | kanał sprzedaży            | always lowercase mid-sentence                       |
| sales channels          | kanały sprzedaży            | plural                                              |
| price list              | cennik                      |                                                     |
| price lists             | cenniki                     | plural                                              |
| quote request           | zapytanie ofertowe          | the "RFQ" concept                                  |
| quote requests          | zapytania ofertowe          | plural                                              |
| order                   | zamówienie                  |                                                     |
| orders                  | zamówienia                  | plural                                              |
| customer                | klient                      | individual; B2B-buyer side                          |
| organisation            | organizacja                 | corporate buyer                                     |
| account                 | konto                       | login/admin context                                 |
| admin user              | użytkownik admina           |                                                     |
| role                    | rola                        |                                                     |
| permission              | uprawnienie                 |                                                     |
| audit log               | dziennik audytu             |                                                     |
| product                 | produkt                     |                                                     |
| products                | produkty                    | nom. plural for `2-4`; `produktów` for `5+`         |
| variant                 | wariant                     |                                                     |
| attribute               | atrybut                     |                                                     |
| attributes              | atrybuty                    |                                                     |
| attribute set           | zestaw atrybutów            |                                                     |
| category                | kategoria                   |                                                     |
| gallery                 | galeria                     |                                                     |
| attachment              | załącznik                   |                                                     |
| inventory               | stany magazynowe            | the noun for "warehouse stock"                      |
| inventory level         | poziom stanu                |                                                     |
| stock                   | stan magazynowy             |                                                     |
| warehouse               | magazyn                     |                                                     |
| warehouses              | magazyny                    | plural                                              |
| promotion               | promocja                    |                                                     |
| promotions              | promocje                    | plural                                              |
| tax rate                | stawka podatku              |                                                     |
| megamenu                | megamenu                    | proper noun; remains untranslated                   |
| blog post               | wpis na blogu               |                                                     |
| CMS page                | strona CMS                  |                                                     |
| dictionary entry        | wpis słownika               |                                                     |
| dictionary              | słownik                     |                                                     |
| setting                 | ustawienie                  |                                                     |
| settings                | ustawienia                  | also the screen name                                |
| setting group           | grupa ustawień              |                                                     |
| global value            | wartość globalna            | settings inheritance                                |
| channel override        | nadpisanie kanału           | settings inheritance                                |
| value (setting)         | wartość                     |                                                     |
| comparison              | porównanie                  | the customer-facing compare feature                 |
| shopping list           | lista zakupów               |                                                     |
| credit limit            | limit kredytowy             |                                                     |
| asset                   | zasób                       | generic file/image asset                            |
| integration             | integracja                  |                                                     |
| webhook                 | webhook                     | proper noun; remains untranslated                   |
| API key                 | klucz API                   |                                                     |
| import                  | import                      |                                                     |
| export                  | eksport                     |                                                     |
| SEO                     | SEO                         | proper noun; remains untranslated                   |
| profile                 | profil                      | "My profile" → "Mój profil"                        |
| login                   | logowanie                   | the noun; the action is "zaloguj się"               |
| sign in (verb)          | zaloguj się                 |                                                     |
| sign out (verb)         | wyloguj się                 |                                                     |
| save                    | zapisz                      | button label; lowercase in sentences                |
| save changes            | zapisz zmiany               | button label                                        |
| discard                 | odrzuć                      | button label                                        |
| cancel                  | anuluj                      | button label                                        |
| delete                  | usuń                        | button label                                        |
| reset                   | resetuj                     | button label                                        |
| reset to default        | przywróć domyślne           | button label                                        |
| edit                    | edytuj                      | button label                                        |
| create                  | utwórz                      | button label                                        |
| add                     | dodaj                       | button label                                        |
| remove                  | usuń                        | reuse "usuń" — context disambiguates                |
| search                  | szukaj                      | verb (button); the noun is "wyszukiwarka"           |
| loading                 | wczytywanie                 | progress label                                      |
| saving                  | zapisywanie                 | progress label                                      |
| empty / no results      | brak wyników                |                                                     |
| settings page title     | Ustawienia                  | capitalised page title                              |
| products page title     | Produkty                    |                                                     |
| categories page title   | Kategorie                   |                                                     |
| customers page title    | Klienci                     |                                                     |
| organisations page      | Organizacje                 |                                                     |

## Adding a new term

When a new module or screen introduces a B2B-domain concept that needs a
canonical Polish rendering, add a row to the glossary table above in the
**same PR** that introduces the strings. Include:

- the English term as it appears in the UI source-of-truth strings,
- the agreed Polish rendering,
- a one-line note when the term is conditional (gender, capitalisation,
  mid-sentence form, abbreviation rules).

If the team disagrees on a Polish rendering, the PR author files a glossary
amendment as a separate PR and references the open module PR — the module PR
unblocks once the glossary lands.

## Adding a new user-visible string

Workflow for any developer adding a new string to the Admin UI:

1. **Find the owning module**: usually `packages/modules/<module>/i18n/`.
   Chrome strings (AppShell, top bar, command palette, profile, login,
   language picker) live in `packages/modules/_i18n/i18n/` under the
   `core` scope — the `_i18n` module ships as the package
   `@endora-commerce/mod-i18n`, and a module package keeps its bundles at its
   own root rather than under `src/`.
2. **Pick a stable key path**: dotted lowercase, e.g. `page.title`,
   `actions.save`, `editor.applyTo.label`. Reuse existing keys where the
   meaning is identical; do not invent parallel keys for "Save".
3. **Add the English entry** to `en.json`. This is the canonical meaning;
   if it includes a count or a name, use `{name}` placeholders.
4. **Add the Polish entry** to `pl.json`. Consult the glossary above. Match
   the placeholder list exactly. For counts in running text use the
   three-pattern strategy described under [Polish quality bar](#polish-quality-bar).
5. **Replace the hard-coded literal** in the source:
   ```tsx
   <Button>{t('actions.save')}</Button>   // where t = useTranslation('moduleId')
   ```
   For server-emitted strings:
   ```ts
   await i18nService.translate('moduleId', 'key', recipientLanguage, params);
   ```
6. **Restart the backend** so the lifecycle reconciler upserts the bundle
   into `translation_bundles`. (Bundle files are read by `readFileSync`,
   not by `tsx watch` — JSON edits don't trigger a hot reload.)
7. **Local check**:
   ```bash
   pnpm --filter backend run i18n:coverage --modules <moduleId> --strict
   ```
   Exit code 0 = clean. Any non-zero exit lists the keys to fix.
8. **CI gate**: every PR that adds a user-visible string **MUST** add both
   English and Polish entries in the owning bundle. CI runs
   `pnpm --filter backend run i18n:coverage -- --strict` for bundle parity and
   `pnpm --filter backend run i18n:hardcoded -- ../admin/src --strict` for JSX
   literals. The coverage diagnostic enforces bundle-side completeness; the
   hardcoded-string lint enforces the Admin UI source side. A PR that drops a
   Polish entry or ships a hard-coded user-visible JSX string fails before
   merge.

## Polish quality bar

- **Native, not literal**: Polish strings are written for a native Polish
  reader, not transliterated from English. A reviewer pass before merge is
  required.
- **Locale formatting**: numbers, dates, currencies, and relative times
  must use Polish locale conventions. Use browser-native `Intl.NumberFormat('pl-PL', …)` /
  `Intl.DateTimeFormat('pl-PL', …)` at the rendering layer; never encode
  locale assumptions in the bundle entry itself.
- **Plurals**: the translation mechanism deliberately ships
  singular-vs-plural only — ICU MessageFormat is deferred. For Polish counts
  in running text follow the three-pattern strategy: avoid the count in
  text, use a colon phrasing, or branch on the count in code.
- **Length**: Polish strings tend to be longer than English. UI containers
  must grow, wrap, or expose a tooltip — never clip or overflow.

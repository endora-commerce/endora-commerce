---
title: CMS
sidebar_position: 1
description: Powierzchnia autorska Page Buildera — Pages, Blocks, Templates, Hooks — per kanał + język
---

# CMS

Moduł CMS to redakcyjna powierzchnia platformy. Posiada cztery encje
tworzone w drag-and-drop **Page Builderze** i eksponowane na storefront z pełnym
scope'owaniem sales-channel i języka.

| Entity      | Identifier        | Lifecycle                            | Embedded by                                   |
| ----------- | ----------------- | ------------------------------------ | --------------------------------------------- |
| **Page**    | `slug` (per channel) | `draft → published → archived`       | URL on the storefront                         |
| **Block**   | `code` (per channel) | `active` flag                        | Pages (`InsertBlock`) and Hooks (attachment)  |
| **Template**| `code` (per channel) | always-visible (no flag)             | Blueprints for pages/blocks (**Save as template** / **Apply template**). Legacy `InsertTemplate` embeds still resolve at runtime. |
| **Hook**    | `code` (global)      | `active` flag, system-protected seed | Storefront layouts (`<Hook code="..." />`)    |

## Encje i graf referencji

Graf encji w runtime:

```
       Hook ──── attachment ────┐
                                ▼
                            Block ─── InsertBlock ───┐
                                                     ▼
                            Template (blueprint) ──> Page / Block canvas (Save as / Apply template)
                            Template ── InsertTemplate (legacy) ──> Page (slug-routed)
```

Szablony treści (`cms_templates`) to wielokrotnie używane layouty Page Buildera (Save as template / Apply template). Szablony e-mail i faktur pozostają we własnych listach admina i magazynie. Osadzanie przez `InsertTemplate` zostało wycofane z palety komponentów; istniejące drzewa nadal się renderują.

Ochrona referencji działa przy każdym usunięciu:

- **Block** odwołany przez Page, Template lub attachment Hooka nie może zostać usunięty (HTTP `409 CMS_REFERENCED`).
- **Template** odwołany przez Page lub Block nie może zostać usunięty.
- **Hook** z flagą `is_system=true` nie może zostać usunięty (`409 CMS_HOOK_SYSTEM_PROTECTED`); Hooki utworzone przez admina są usuwalne.

Każde skanowanie referencji to przejście JSONB po envelope `content` encji (`page→block`, `page→template`, `block→template`, `template→block`) plus sprawdzenie klucza obcego w `cms_hook_block_attachments` dla `hook→block`.

Ten sam JSONB `content` skanuje też **rejestr referencji Assets Library** — usunięcie Assetu osadzonego w `props` komponentu CMS jest podobnie odrzucane.

## Autoring Page Buildera

Page Builder opiera się na **Puck** (`@measured/puck`) i dostarcza komponenty
w `@endora-commerce/cms-components`. Domyślne layout/content:

| Component       | Purpose                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `Row`           | Kontener layoutu flex-column.                                          |
| `Heading`       | `h1`–`h6` z wyborem wyrównania i poziomu.                              |
| `Text`          | Prosty tekst z kontrolami typografii.                                  |
| `RichContent`   | TipTap rich text (modal linków, kolory, obrazy).                       |
| `Button`        | Etykieta + cel linku + wariant.                                        |
| `Image`         | URL lub biblioteka assetów; tryby szerokości + wyrównanie.             |
| `Icons`         | Wizualny picker ikon Lucide (~100 wyselekcjonowanych ikon).          |
| `Social`        | Ikony social brand (`react-icons`); lista linków pokazuje nazwy sieci. |
| `Spacer`        | Odstęp pionowy + opcjonalny separator.                                 |
| `FeatureList`   | Kolumny ikona + tytuł + opis.                                          |
| `Hero`          | Baner CTA z tłem, nagłówkiem i przyciskiem.                            |
| `LogoStrip`     | Logotypy partnerów / zaufania.                                         |
| `Testimonial`   | Cytat + autor (+ opcjonalny avatar).                                   |
| `Stats`         | Pasek KPI / liczników.                                                 |
| `AnnouncementBar` | Cienki pasek promocyjny.                                             |
| `SimpleTable`   | Prosta tabela z separatorem pipe.                                      |
| `NewsletterSignup` | Formularz zapisu e-mail (konfigurowalny action URL).                |
| `ContactFormEmbed` | Osadzenie iframe formularza lub mailto.                             |
| `InsertBlock`   | Osadza Block po `code`. Storefront inline'uje rozwiązany Block.       |
| `InsertTemplate`| Legacy: osadza Template po `code`. Zachowany dla istniejących drzew; **nie** w palecie drawer. Preferuj Save as / Apply template. |

Dodatkowe kategorie (catalog, media, interactive, forms, advanced) dostarczają
Product*, Video, Map, slidery, Tabs, Accordion, RawHtml/RawJs itd.

### Viewporty podglądu

Ramki Puck Mobile / Tablet / Desktop używają logicznych szerokości **360 / tabletMin /
max(desktopMin, 1280)**. Zoom to wbudowany Puck `transform: scale` wewnątrz
iframe (`waitForStyles: true`). Preferuj przełącznik viewportu zamiast resize
przeglądarki przy sprawdzaniu responsywnych props — reguły CSS `@media` rozwiązują się
względem szerokości iframe, podczas gdy JS warstwy edycji używa wybranej szerokości viewportu.

Drzewo treści jest persystowane w envelope JSONB:

```jsonc
{
  "schema_version": 1,
  "languages": {
    "pl-PL": { /* Puck Data tree */ },
    "en-US": { /* Puck Data tree */ }
  }
}
```

`schema_version` jest podnoszone tylko gdy zmienia się kształt magazynu węzła. Boot-time `content-schema-upgrader` przechodzi każde zapisane drzewo i przepisuje węzły in-place; bieżące komponenty startują od `schema_version=1`.

## Scope sales-channel + język

Każda Page, Block, Template i Hook jest powiązana z jednym lub więcej sales
channels (join M:N z denormalizowanym `code`/`slug` na wierszu join, żeby
egzekwować unikalność per kanał na poziomie DB). Ten sam `slug` może istnieć
w dwóch kanałach — to niezależne wiersze. Języki żyją jako tablica JSONB na każdej
encji; resolver storefront stosuje standardową platformową regułę fallback
(żądany → domyślny kanału → 404).

Admin `ScopePicker` ogranicza listę języków per kanał do skonfigurowanego
zestawu języków kanału; zapis Page, której `languages` zawiera kod
nieobsługiwany przez żaden przypisany kanał, zwraca
`400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`.

## Seedowane Hooki

23 bazowe kody Hook są seedowane z `is_system=true` przy boot przez
idempotentny reconciler. Obejmują standardowe punkty wstawienia storefront:

```
header.top
homepage.top, homepage.bottom
footer.before, footer.top, footer.bottom, footer.after, footer.copyright
category.top, category.bottom
product.top, product.bottom, product.buttons.after
search.top, search.bottom
page.top, page.bottom
cms.page.top, cms.page.bottom
login.top, login.bottom
register.top, register.bottom
```

Każdy `<Hook code="…" />` server component pobiera
`/api/v1/cms/hooks/by-code` z rozwiązanym kanałem + językiem i
renderuje każdy aktywny dołączony Block w kolejności `position`. Puste
attachmenty i nieudane fetch'e renderują nic — Hooki nie mogą psuć renderu strony.

## Powierzchnia HTTP

### Admin (`/api/v1/admin/cms`)

| Method  | Path                                                | Purpose                                         |
| ------- | --------------------------------------------------- | ----------------------------------------------- |
| GET     | `/pages`                                            | Paginowana lista Page z filtrami.               |
| POST    | `/pages`                                            | Utworzenie Page (zawsze startuje jako `draft`). |
| GET     | `/pages/:id`                                        | Szczegóły z pełnym envelope content + version.  |
| PATCH   | `/pages/:id`                                        | Edycja metadanych; respektuje `If-Match` przez `version`.|
| PUT     | `/pages/:id/content/:language`                      | Zapis drzewa Page Buildera per język.            |
| POST    | `/pages/:id/{publish,archive,unarchive}`            | Przejścia cyklu życia.                          |
| DELETE  | `/pages/:id`                                        | Hard delete (kanały są cascade-unbound).        |
| Same    | `/blocks/*`                                         | Ten sam kształt; `code` unikalny per kanał; ochrona referencji przy delete. |
| Same    | `/templates/*`                                      | Ten sam kształt bez flagi `active`.             |
| GET     | `/hooks`, `/hooks/:id`                              | Lista + szczegóły z liczbą attachmentów.        |
| POST    | `/hooks`                                            | Utworzenie Hooka admin (non-system).            |
| PATCH   | `/hooks/:id`                                        | Edycja name / active / scope; `code` jest niemutowalne.|
| DELETE  | `/hooks/:id`                                        | Odmowa z 409 gdy `is_system=true`.              |
| GET / POST / PATCH / DELETE | `/hooks/:id/attachments[/:blockId]` | Dołącz / reorder / detach Blocków na Hooku.     |
| GET     | `/page-builder/config`                              | Scalony deskryptor Page Buildera (tylko metadane).|

### Storefront (`/api/v1/cms`)

| Method | Path                              | Returns                                                        |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| GET    | `/pages/by-slug?slug=…&language=…`| Rozwiązana Page z `embeds.blocks`, `embeds.templates`, assets. |
| GET    | `/blocks/by-code?code=…&language=…`| Rozwiązany Block (pojedynczy, filtrowany kanałem, tylko active).|
| GET    | `/hooks/by-code?code=…&language=…`| Uporządkowana lista aktywnych Blocków dla nazwanego Hooka.     |

Rozwiązywanie kanału preferuje nagłówek `X-Sales-Channel`, potem fallback
do domyślnego kanału systemowego. Rozwiązywanie języka preferuje `?language=`,
potem `Accept-Language`, potem domyślny język skonfigurowany dla kanału.

## Rozwiązywanie storefront + cache Redis

Pojedynczy serwis `StorefrontResolver` obsługuje wszystkie trzy operacje odczytu
storefront jednym query dla encji root, jednym batch query
per typ embed (`InsertBlock` / `InsertTemplate`) per poziom rekursji
oraz jednym batch call do `assetsLibrary.resolveUrl` dla każdego osadzonego
asseta. Rekursja jest ograniczona głębokością 3; cykle lub głębsze grafy
degradują do `MissingComponentPlaceholder` renderowanego po stronie admina.

Rozwiązane payloady są cache'owane w Redis z TTL 5 minut pod trzema
rodzinami kluczy:

```
cms:v1:page:<slug>:<channel>:<language>
cms:v1:block:<code>:<channel>:<language>
cms:v1:hook:<code>:<channel>:<language>
```

Invalidacja działa przy każdym zapisie Page / Block / Template / Hook:

- Zapis Page → usuwa `cms:v1:page:<slug>:*` dla każdego slug, do którego page jest przypisana.
- Zapis Block → usuwa własne klucze block + każdy wpis page-keyed (jeszcze nie śledzimy, które pages embedują który block; coarse drop jest akceptowalny w skali platformy).
- Zapis Template → usuwa każdy klucz w namespace CMS.
- Zapis Hook / attachment → usuwa klucze hooka.

Cel wydajności: rozwiązywanie strony z 5 osadzonymi Blockami + 3 osadzonymi
Templates zwraca w &lt; 200 ms p95 cold; warm path zwraca w &lt; 5 ms.

## Migracja z legacy `cms_pages`

Przed 014 `cms_pages` niosło `path` + `body` (HTML per język) i enum
`status`. Migracja `035_cms_init.ts` dodaje nowy zestaw kolumn
(`slug`, `name`, `active`, `content`, `languages`, `version`, `meta_*`)
i idempotentnie backfilluje każdy wiersz:

- `slug = path`
- `name = title['en-US']` (best effort)
- `active = (status = 'published')`
- envelope `content` z `body` z HTML każdego języka opakowanym w pojedynczy węzeł `Text` z `tiptapHtml`
- tablica `languages` = klucze body niepustych
- powiązanie z domyślnym sales channel platformy przez `cms_page_sales_channels`

Ponowne uruchomienie backfillu na częściowo zmigrowanym stanie to no-op.
Legacy kolumny `path`, `title` i `body` przeżywają jeden release jako
lustra; skan referencji assetów obejmuje `body` dla kompatybilności wstecznej.

## Rozszerzanie Page Buildera

Inne moduły backendu wnoszą komponenty przez SPI w
`packages/modules/cms/src/backend/services/page-builder-registry.ts`. Zob.
przewodnik [Extending the Page Builder](./extending-page-builder) dla
end-to-end workflow: deklaracja deskryptora, dostarczenie renderera i
wiring kompozycji.

## Kody błędów

`CMS_PAGE_NOT_FOUND`, `CMS_BLOCK_NOT_FOUND`, `CMS_TEMPLATE_NOT_FOUND`,
`CMS_HOOK_NOT_FOUND`, `CMS_SLUG_CONFLICT`, `CMS_CODE_CONFLICT`,
`CMS_REFERENCED`, `CMS_HOOK_SYSTEM_PROTECTED`,
`CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `CMS_SCHEMA_UPGRADE_FAILED`.

Wszystkie envelope'y stosują platformowy kontrakt błędów w
`packages/contracts/src/errors.ts`.

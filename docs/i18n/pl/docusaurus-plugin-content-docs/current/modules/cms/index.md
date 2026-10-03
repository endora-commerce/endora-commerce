---
title: CMS
sidebar_position: 1
description: Tworzenie treści w Page Builderze — strony, bloki, szablony, hooki — osobno dla kanałów i języków
---

# CMS

Moduł CMS to redakcyjna część platformy. Odpowiada za cztery encje tworzone w edytorze **Page
Builder** (przeciągnij i upuść) i udostępniane w storefroncie z pełnym zawężeniem do kanału
sprzedaży i języka.

| Encja      | Identyfikator        | Cykl życia                            | Gdzie jest osadzana                                   |
| ----------- | ----------------- | ------------------------------------ | --------------------------------------------- |
| **Strona**    | `slug` (w obrębie kanału) | `draft → published → archived`       | Adres w storefroncie                         |
| **Blok**   | `code` (w obrębie kanału) | flaga `active`                        | Strony (`InsertBlock`) i hooki (przypięcie)  |
| **Szablon**| `code` (w obrębie kanału) | zawsze widoczny (bez flagi)             | Wzorce stron i bloków (**Save as template** / **Apply template**). Dawne osadzenia `InsertTemplate` nadal działają. |
| **Hook**    | `code` (globalny)      | flaga `active`, wpisy początkowe chronione przez system | Układy storefrontu (`<Hook code="..." />`)    |

## Encje i graf odwołań

Graf encji w czasie działania:

```
       Hook ──── attachment ────┐
                                ▼
                            Block ─── InsertBlock ───┐
                                                     ▼
                            Template (blueprint) ──> Page / Block canvas (Save as / Apply template)
                            Template ── InsertTemplate (legacy) ──> Page (slug-routed)
```

Szablony treści (`cms_templates`) to wielokrotnego użytku układy Page Buildera (Save as template /
Apply template). Szablony e-maili i faktur mają własne listy w panelu i własne miejsce
przechowywania. Osadzanie przez `InsertTemplate` usunięto z palety komponentów; istniejące drzewa
nadal się wyświetlają.

Ochrona odwołań działa przy każdym usuwaniu:

- **Bloku**, do którego odwołuje się strona, szablon albo przypięcie do hooka, nie można usunąć (HTTP
  `409 CMS_REFERENCED`).
- **Szablonu**, do którego odwołuje się strona albo blok, nie można usunąć.
- **Hooka** z flagą `is_system=true` nie można usunąć (`409 CMS_HOOK_SYSTEM_PROTECTED`); hooki
  utworzone przez administratora można usuwać.

Każde wyszukiwanie odwołań to przejście JSONB po strukturze `content` encji (`page→block`,
`page→template`, `block→template`, `template→block`) oraz sprawdzenie klucza obcego w
`cms_hook_block_attachments` dla `hook→block`.

Tę samą zawartość JSONB `content` przeszukuje też **rejestr odwołań biblioteki mediów** — usunięcie
pliku osadzonego we właściwościach (`props`) komponentu CMS jest odrzucane w ten sam sposób.

## Tworzenie treści w Page Builderze

Page Builder jest zbudowany na **Puck** (`@measured/puck`), a komponenty dostarcza
`@endora-commerce/cms-components`. Domyślne komponenty układu i treści:

| Komponent       | Przeznaczenie                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `Row`           | Kontener układu w kolumnie (flex).                                          |
| `Heading`       | `h1`–`h6` z wyborem wyrównania i poziomu.                              |
| `Text`          | Zwykły tekst z ustawieniami typografii.                                  |
| `RichContent`   | Tekst sformatowany TipTap (okno linków, kolory, obrazy).                       |
| `Button`        | Etykieta, cel linku i wariant.                                        |
| `Image`         | Adres URL albo plik z biblioteki; tryby szerokości i wyrównanie.             |
| `Icons`         | Graficzny wybór ikon Lucide (ok. 100 wybranych ikon).          |
| `Social`        | Ikony serwisów społecznościowych (`react-icons`); lista linków pokazuje nazwy serwisów. |
| `Spacer`        | Odstęp pionowy z opcjonalną linią oddzielającą.                                 |
| `FeatureList`   | Kolumny z ikoną, tytułem i opisem.                                          |
| `Hero`          | Baner z wezwaniem do działania: tło, nagłówek i przycisk.                            |
| `LogoStrip`     | Logotypy partnerów lub klientów.                                         |
| `Testimonial`   | Cytat i autor (z opcjonalnym zdjęciem).                                   |
| `Stats`         | Pasek wskaźników lub liczników.                                                 |
| `AnnouncementBar` | Wąski pasek z komunikatem promocyjnym.                                             |
| `SimpleTable`   | Prosta tabela z kolumnami rozdzielonymi znakiem `\|`.                                      |
| `NewsletterSignup` | Formularz zapisu na newsletter (konfigurowalny adres wysyłki formularza).                |
| `ContactFormEmbed` | Osadzony formularz w iframe albo link mailto.                             |
| `InsertBlock`   | Osadza blok według `code`. Storefront wstawia treść odnalezionego bloku.       |
| `InsertTemplate`| Dawny komponent: osadza szablon według `code`. Zachowany dla istniejących drzew; **nie** ma go w palecie. Zamiast niego używaj Save as / Apply template. |

Dodatkowe kategorie (katalog, media, elementy interaktywne, formularze, zaawansowane) dostarczają
komponenty Product*, Video, Map, karuzele, Tabs, Accordion, RawHtml/RawJs itd.

### Rozmiary podglądu

Ramki podglądu Puck dla telefonu, tabletu i komputera mają logiczne szerokości **360 / tabletMin /
max(desktopMin, 1280)**. Powiększenie to wbudowane w Puck `transform: scale` wewnątrz iframe
(`waitForStyles: true`). Sprawdzając ustawienia responsywne, korzystaj z przełącznika rozmiaru
podglądu zamiast zmieniać rozmiar okna przeglądarki — reguły CSS `@media` zależą od szerokości iframe,
a skrypty warstwy edycji korzystają z wybranej szerokości podglądu.

Drzewo treści jest zapisywane w strukturze JSONB:

```jsonc
{
  "schema_version": 1,
  "languages": {
    "pl-PL": { /* Puck Data tree */ },
    "en-US": { /* Puck Data tree */ }
  }
}
```

`schema_version` jest zwiększane tylko wtedy, gdy zmienia się sposób zapisu węzła. Mechanizm
`content-schema-upgrader` przy starcie przechodzi przez każde zapisane drzewo i przepisuje węzły na
miejscu; obecne komponenty zaczynają od `schema_version=1`.

## Zakres: kanał sprzedaży i język

Każda strona, blok, szablon i hook jest przypisany do jednego lub kilku kanałów sprzedaży (relacja
wiele-do-wielu z powielonym `code`/`slug` w wierszu łączącym, aby baza danych pilnowała unikalności w
obrębie kanału). Ten sam `slug` może istnieć w dwóch kanałach — to niezależne wiersze. Języki są
zapisane jako tablica JSONB w każdej encji; odczyt w storefroncie stosuje standardową regułę
wartości zastępczej platformy (żądany język → język domyślny kanału → 404).

`ScopePicker` w panelu ogranicza listę języków dla kanału do zbioru języków skonfigurowanych w tym
kanale; zapis strony, której `languages` zawiera kod nieobsługiwany przez żaden z przypisanych
kanałów, zwraca `400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`.

## Hooki tworzone przy instalacji

Przy starcie idempotentny mechanizm uzgadniania tworzy 23 podstawowe kody hooków z
`is_system=true`. Obejmują standardowe miejsca wstawiania treści w storefroncie:

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

Każdy komponent serwerowy `<Hook code="…" />` pobiera `/api/v1/cms/hooks/by-code` z wyznaczonym
kanałem i językiem i wyświetla każdy aktywny przypięty blok w kolejności `position`. Brak przypięć
albo nieudane pobranie nic nie wyświetla — hooki nie mogą zepsuć wyświetlania strony.

## API HTTP

### Panel administracyjny (`/api/v1/admin/cms`)

| Metoda  | Ścieżka                                                | Przeznaczenie                                         |
| ------- | --------------------------------------------------- | ----------------------------------------------- |
| GET     | `/pages`                                            | Stronicowana lista stron z filtrami.               |
| POST    | `/pages`                                            | Utworzenie strony (zawsze zaczyna jako `draft`). |
| GET     | `/pages/:id`                                        | Szczegóły z pełną treścią i wersją.  |
| PATCH   | `/pages/:id`                                        | Edycja metadanych; uwzględnia `If-Match` przez `version`.|
| PUT     | `/pages/:id/content/:language`                      | Zapis drzewa Page Buildera dla danego języka.            |
| POST    | `/pages/:id/{publish,archive,unarchive}`            | Przejścia w cyklu życia.                          |
| DELETE  | `/pages/:id`                                        | Trwałe usunięcie (przypisania do kanałów są usuwane kaskadowo).        |
| Analogicznie    | `/blocks/*`                                         | Ta sama postać; `code` unikalny w obrębie kanału; ochrona odwołań przy usuwaniu. |
| Analogicznie    | `/templates/*`                                      | Ta sama postać, bez flagi `active`.             |
| GET     | `/hooks`, `/hooks/:id`                              | Lista i szczegóły z liczbą przypiętych bloków.        |
| POST    | `/hooks`                                            | Utworzenie hooka przez administratora (niesystemowego).            |
| PATCH   | `/hooks/:id`                                        | Edycja nazwy, aktywności i zakresu; `code` nie można zmienić.|
| DELETE  | `/hooks/:id`                                        | Odrzucane z 409, gdy `is_system=true`.              |
| GET / POST / PATCH / DELETE | `/hooks/:id/attachments[/:blockId]` | Przypinanie, zmiana kolejności i odpinanie bloków w hooku.     |
| GET     | `/page-builder/config`                              | Połączony opis Page Buildera (tylko metadane).|

### Storefront (`/api/v1/cms`)

| Metoda | Ścieżka                              | Zwraca                                                        |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| GET    | `/pages/by-slug?slug=…&language=…`| Stronę z `embeds.blocks`, `embeds.templates` i plikami. |
| GET    | `/blocks/by-code?code=…&language=…`| Blok (jeden, z filtrowaniem według kanału, tylko aktywny).|
| GET    | `/hooks/by-code?code=…&language=…`| Uporządkowaną listę aktywnych bloków dla wskazanego hooka.     |

Kanał jest wyznaczany najpierw z nagłówka `X-Sales-Channel`, a w jego braku jest to domyślny kanał
systemowy. Język — najpierw z `?language=`, potem z `Accept-Language`, a na końcu jest to język
domyślny skonfigurowany dla kanału.

## Odczyt w storefroncie i pamięć podręczna w Redis

Jedna usługa, `StorefrontResolver`, obsługuje wszystkie trzy odczyty dla storefrontu: jedno
zapytanie dla encji głównej, jedno zapytanie zbiorcze dla każdego typu osadzenia (`InsertBlock` /
`InsertTemplate`) na każdym poziomie zagnieżdżenia oraz jedno zbiorcze wywołanie
`assetsLibrary.resolveUrl` dla wszystkich osadzonych plików. Zagnieżdżenie jest ograniczone do 3
poziomów; cykle i głębsze grafy są zastępowane elementem `MissingComponentPlaceholder` widocznym w
panelu.

Wyniki są przechowywane w Redis z TTL 5 minut, w trzech rodzinach kluczy:

```
cms:v1:page:<slug>:<channel>:<language>
cms:v1:block:<code>:<channel>:<language>
cms:v1:hook:<code>:<channel>:<language>
```

Unieważnianie następuje przy każdym zapisie strony, bloku, szablonu lub hooka:

- Zapis strony → usuwa `cms:v1:page:<slug>:*` dla każdego sluga przypisanego do strony.
- Zapis bloku → usuwa klucze bloku i wszystkie klucze stron (nie śledzimy jeszcze, które strony
  osadzają który blok; w skali platformy usuwanie całości jest akceptowalne).
- Zapis szablonu → usuwa wszystkie klucze w przestrzeni CMS.
- Zapis hooka albo przypięcia → usuwa klucze hooka.

Cel wydajnościowy: odczyt strony z 5 osadzonymi blokami i 3 osadzonymi szablonami trwa
&lt; 200 ms p95 bez pamięci podręcznej, a z nią &lt; 5 ms.

## Migracja z dawnego `cms_pages`

Wcześniej `cms_pages` zawierało `path`, `body` (HTML w poszczególnych językach) i wyliczenie
`status`. Migracja `035_cms_init.ts` dodaje nowy zestaw kolumn (`slug`, `name`, `active`, `content`,
`languages`, `version`, `meta_*`) i idempotentnie uzupełnia każdy wiersz:

- `slug = path`
- `name = title['en-US']` (w miarę możliwości)
- `active = (status = 'published')`
- struktura `content` z `body`, w której HTML każdego języka trafia do pojedynczego węzła `Text` z
  `tiptapHtml`
- tablica `languages` = klucze niepustych treści w `body`
- przypisanie do domyślnego kanału sprzedaży platformy przez `cms_page_sales_channels`

Ponowne uruchomienie uzupełniania na częściowo zmigrowanych danych niczego nie zmienia. Dawne kolumny
`path`, `title` i `body` pozostają przez jedno wydanie jako kopie; wyszukiwanie odwołań do plików
obejmuje `body` ze względu na zgodność wsteczną.

## Rozszerzanie Page Buildera

Inne moduły backendu dodają komponenty przez interfejs w
`packages/modules/cms/src/backend/services/page-builder-registry.ts`. Cały proces — deklarację
opisu, dostarczenie komponentu wyświetlającego i podłączenie przy kompozycji — opisuje przewodnik
[Rozszerzanie Page Buildera](./extending-page-builder).

## Kody błędów

`CMS_PAGE_NOT_FOUND`, `CMS_BLOCK_NOT_FOUND`, `CMS_TEMPLATE_NOT_FOUND`, `CMS_HOOK_NOT_FOUND`,
`CMS_SLUG_CONFLICT`, `CMS_CODE_CONFLICT`, `CMS_REFERENCED`, `CMS_HOOK_SYSTEM_PROTECTED`,
`CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `CMS_SCHEMA_UPGRADE_FAILED`.

Wszystkie odpowiedzi z błędem mają strukturę zgodną z kontraktem błędów platformy w
`packages/contracts/src/errors.ts`.

---
title: Megamenu
sidebar_position: 1
description: Konfigurowalne drzewo nawigacji przypisywane osobno do każdej pary kanału i języka
---

# Megamenu

Moduł Megamenu odpowiada za główną nawigację storefrontu. Wprowadza konfigurowalne drzewo pozycji
menu, tworzone w panelu administracyjnym i przypisywane do par `(kanał sprzedaży × język)`,
generowane po stronie serwera w Next.js, z rozwijanym panelem na całą szerokość, otwieranym po
najechaniu kursorem na komputerze, i wysuwanym menu z kolejnymi poziomami na telefonie.

## Encje i rodzaje pozycji

| Encja              | Identyfikator                          | Uwagi                                                  |
| ------------------- | ----------------------------------- | ------------------------------------------------------ |
| **Megamenu**        | `id` (uuid)                         | Wiersz konfiguracji — nazwa, opis, wersja.      |
| **MegamenuItem**    | `id` (uuid) + `parentId` (odwołanie do tej samej tabeli)  | Węzeł drzewa zapisanego listą sąsiedztwa, z `target` zależnym od rodzaju. |
| **MegamenuBinding** | `(megamenuId, salesChannelId, language)` | Flaga `active` dla danego zakresu, pilnowana częściowym indeksem unikalnym. |

Zamknięty zbiór rodzajów pozycji:

| `kind`            | Postać celu                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `category-link`   | `{ categoryId, iconAssetId?, iconPosition? }`                         |
| `cms-page-link`   | `{ pageId, iconAssetId?, iconPosition? }`                             |
| `external-link`   | `{ url, iconAssetId?, iconPosition? }` (URL: `http\|https\|tel\|mailto`) |
| `button`          | `{ url, variant: 'primary'\|'secondary'\|'ghost' }`                   |
| `asset`           | `{ assetId, kind: 'image'\|'video' }`                                 |
| `cms-block-embed` | `{ blockId, embedSide: 'left'\|'right' }`                             |

Opcjonalne `iconAssetId` przyjmuje tylko pliki z biblioteki mediów rodzaju `image`; walidacja
odrzuca pliki innego rodzaju.

## Zasady aktywacji

W danej chwili dla pary `(kanał sprzedaży, język)` aktywne (`active`) może być najwyżej jedno
megamenu. Baza danych wymusza to przez:

```sql
CREATE UNIQUE INDEX megamenu_bindings_active_uniq
  ON megamenu_bindings (sales_channel_id, language)
  WHERE active = true;
```

Transakcja aktywacji:

1. `UPDATE megamenu_bindings SET active = false WHERE sales_channel_id = ? AND language = ? AND active = true;` — dezaktywuje dotychczas aktywne menu (jeśli było).
2. `UPDATE megamenu_bindings SET active = true WHERE megamenu_id = ? AND sales_channel_id = ? AND language = ?;` — aktywuje wskazane przypisanie.

Obie instrukcje wykonują się w jednej transakcji, więc częściowy indeks unikalny nigdy nie widzi
stanu z dwoma aktywnymi menu. Endpoint aktywacji zwraca dotychczas aktywne menu w
`previouslyActive`, aby okno potwierdzenia w panelu mogło pokazać „przełączono z `<name>`”.

Aktywacja pustego drzewa jest odrzucana z `400 MEGAMENU_EMPTY_TREE`. Usunięcie konfiguracji jest
odrzucane z `409 MEGAMENU_HAS_ACTIVE_BINDINGS`, gdy choć jedno przypisanie ma `active = true`
(administrator musi najpierw je dezaktywować).

## Zakres: kanał sprzedaży i język

Konfiguracja może mieć wiele przypisań `(salesChannelId, language)`. Endpoint przypisań odrzuca
język spoza zbioru języków skonfigurowanych dla kanału z `400 MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`.
Po usunięciu przypisania dany zakres nie ma megamenu, dopóki nie zostanie aktywowana inna
konfiguracja.

Wartość zastępcza etykiety: gdy pozycja nie ma etykiety w żądanym języku, storefront używa języka
domyślnego kanału. Pozycje bez etykiety w obu językach są po cichu pomijane w wynikowym drzewie
(administrator widzi ostrzeżenie w edytorze).

## Głębokość drzewa

Głębokość drzewa to wskazówka dotycząca użyteczności, a nie twarde ograniczenie. Model danych nie
ma limitu. Formularz w panelu pokazuje nieblokujące ostrzeżenie po przekroczeniu 4 poziomów:

```
meta.warnings: [{ code: "MEGAMENU_DEPTH_EXCEEDED", message: "..." }]
```

Zapis i tak się udaje; każdy poziom jest wyświetlany w storefroncie.

## Ochrona odwołań

Pozycje megamenu mają luźne odwołania do encji z innych modułów (kategorii, stron CMS, bloków CMS,
plików z biblioteki mediów). Usunięcie którejkolwiek z nich jest odrzucane, dopóki megamenu się do
niej odwołuje:

| Encja | Rejestr / moduł                       | Dopasowanie w megamenu_items.target  |
| --------------- | --------------------------------------- | ------------------------------------ |
| Plik z biblioteki mediów   | `AssetReferenceRegistry`                | `assetId` OR `iconAssetId`           |
| Strona CMS        | `CmsReferenceRegistry`                  | `kind='cms-page-link' AND pageId = ?` |
| Blok CMS       | `CmsReferenceRegistry`                  | `kind='cms-block-embed' AND blockId = ?` |
| Kategoria        | (rejestr odwołań do kategorii w katalogu)   | `kind='category-link' AND categoryId = ?` (planowane) |

Każda rejestracja to jedno wywołanie we własnym hooku startowym modułu megamenu (`ctx.onBoot` w
`src/backend/index.ts` modułu). Istniejące
`findBlockReferences` / `findTemplateReferences` modułu CMS rozszerzono tak, aby sprawdzały
zewnętrzne skanery; `registerMegamenuCmsReferences` modułu megamenu rejestruje tam swój skaner.

Rejestr odwołań do kategorii jest planowany w module katalogu; dopóki nie powstanie, ochrona przed
usunięciem kategorii używanej w megamenu działa na poziomie walidacji (megamenu nie może zapisać
pozycji wskazującej usuniętą kategorię — sprawdzenie kategorii zwraca `false`, a administrator widzi
czytelny błąd).

## Odczyt w storefroncie i pamięć podręczna w Redis

Jeden endpoint odczytu:

```
GET /api/v1/megamenu/by-channel?language=<bcp-47>
X-Sales-Channel: <channel-code>
```

Mechanizm odczytu:

1. Wyszukuje aktywne przypisanie przez częściowy indeks unikalny (1 zapytanie).
2. Odczytuje wszystkie pozycje tego megamenu w kolejności `(parent_id, position)` (1 zapytanie).
3. Przechodzi drzewo, obsługując każdy rodzaj `kind`: buduje adresy kategorii i stron CMS ze slugów,
   podpisuje adresy plików przez bibliotekę mediów, wstawia bloki CMS przez mechanizm odczytu CMS dla
   storefrontu i uzupełnia ikony.
4. Zwraca rekurencyjną strukturę `ResolvedMegamenu`.

Wynik jest przechowywany w Redis pod kluczem `megamenu:v1:<channel>:<language>` z TTL 5 minut.
Unieważnianie:

- `POST /menus`, `PATCH /menus/:id`, `PUT /menus/:id/items`, `DELETE /menus/:id` → usunięcie
  wszystkich kluczy `megamenu:v1:*` (jedno menu może obsługiwać wiele przypisań).
- `POST /menus/:id/bindings` / `DELETE /menus/:id/bindings/:channel/:language` → usunięcie klucza
  dla zmienionego zakresu.
- `POST /menus/:id/activate` / `POST /menus/:id/deactivate` → usunięcie klucza dla aktywowanego lub
  dezaktywowanego zakresu.

Pamięć podręczna działa dokładnie tak jak `CmsCache` modułu CMS (ten sam schemat przedrostka, ten
sam TTL, to samo unieważnianie oparte na SCAN).

## Wyświetlanie w storefroncie

### Komputer

Odtwarza panel `.mega` z projektu Industria: rozwijany panel na całą szerokość pod paskiem
nawigacji, otwierany po najechaniu kursorem (`onMouseEnter`) i zamykany po jego zjechaniu
(`onMouseLeave`). Panel korzysta z siatki trzech kolumn `220px 1fr 280px` z `gap: 32px` i
`padding: 28px 0`. Trzecią kolumnę wypełnia pierwsza pozycja podrzędna `cms-block-embed` z
`embedSide === 'right'` (osadzenie `left` trafia do pierwszej kolumny i przesuwa siatkę linków w
prawo).

### Telefon

Poniżej `768px` wyświetla się przycisk menu. Dotknięcie otwiera wysuwane menu z kolejnymi
poziomami; dotknięcie pozycji nadrzędnej przechodzi do następnego poziomu (stan komponentu), z
przyciskiem „Back”. Osadzone bloki CMS, przyciski i pliki są wyświetlane jeden pod drugim (bez
układu obok siebie). Przywracanie pozycji przewinięcia przez przeglądarkę spełnia wymaganie
„zachowuje przewinięcie na poziomach nadrzędnych”.

## API HTTP

### Panel administracyjny (`/api/v1/admin/megamenu`)

| Metoda  | Ścieżka                                                        | Przeznaczenie                                              |
| ------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| GET     | `/menus`                                                    | Lista konfiguracji z liczbą przypisań.              |
| POST    | `/menus`                                                    | Utworzenie megamenu (bez pozycji i przypisań).     |
| GET     | `/menus/:id`                                                | Szczegóły z drzewem i przypisaniami.                  |
| PATCH   | `/menus/:id`                                                | Edycja metadanych. Uwzględnia `If-Match` przez `version`. |
| DELETE  | `/menus/:id`                                                | Odrzucane, gdy którekolwiek przypisanie ma `active = true`. |
| PUT     | `/menus/:id/items`                                          | Zapis całego drzewa pozycji (pełne nadpisanie).         |
| GET     | `/menus/:id/bindings`                                       | Lista wszystkich przypisań konfiguracji.               |
| POST    | `/menus/:id/bindings`                                       | Dodanie przypisania `(channel, language)` (zawsze nieaktywnego). |
| DELETE  | `/menus/:id/bindings/:salesChannelId/:language`             | Usunięcie przypisania (idempotentne).                   |
| POST    | `/menus/:id/activate`                                       | Atomowa zamiana aktywnego menu.                           |
| POST    | `/menus/:id/deactivate`                                     | Dezaktywacja przypisania.                             |

### Storefront (`/api/v1/megamenu`)

| Metoda | Ścieżka                              | Zwraca                                                                 |
| ------ | --------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/by-channel?language=…`          | Megamenu dla żądanego zakresu; `404 MEGAMENU_NOT_FOUND`, gdy nie ma aktywnego przypisania. |

## Wprowadzenie modułu

Migracja `20260505T193836_megamenu_init.ts` dodaje trzy nowe tabele i częściowy indeks unikalny. Nie tworzy
żadnych wierszy; administratorzy tworzą pierwszą konfigurację w panelu.

Megamenu jest umieszczone w głównym układzie storefrontu, między `<Header>` a istniejącym hookiem
`header.bottom`. Integracja z hookami CMS pozostaje bez zmian.

## Kody błędów

`MEGAMENU_NOT_FOUND`, `MEGAMENU_HAS_ACTIVE_BINDINGS`, `MEGAMENU_EMPTY_TREE`,
`MEGAMENU_BINDING_NOT_FOUND`, `MEGAMENU_BINDING_ALREADY_EXISTS`,
`MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `MEGAMENU_TARGET_OUT_OF_SCOPE`,
`MEGAMENU_ASSET_KIND_MISMATCH`, `MEGAMENU_REFERENCED`, `MEGAMENU_DEPTH_EXCEEDED`.

Wszystkie odpowiedzi z błędem mają strukturę zgodną z kontraktem błędów platformy w
`packages/contracts/src/errors.ts`.

## Poza zakresem (v1)

- Warianty megamenu dla grup klientów albo organizacji.
- Testy A/B wariantów menu.
- Podgląd w panelu bez publikacji.
- Pozycje wskazujące bezpośrednio stronę produktu (użyj linku do kategorii albo linku zewnętrznego).
- Pozycje z plikiem podanym dowolnym adresem URL: naturalnym miejscem na pobieranie, sprawdzanie i
  przechowywanie zewnętrznych plików jest `importFromUrl` po stronie serwera w bibliotece mediów;
  walidacja modułu Megamenu odrzuca takie pozycje, dopóki ta funkcja nie powstanie. Administratorzy
  najpierw przesyłają plik do biblioteki i odwołują się do niego po identyfikatorze.
- Budowanie drzewa przez przeciąganie w panelu: edytor v1 korzysta z przycisków w górę, w dół, usuń
  i dodaj pozycję podrzędną. `@dnd-kit` nie jest dołączany do aplikacji panelu, a założenia
  kładły nacisk na samą edycję drzewa, a nie na wyrafinowane gesty.

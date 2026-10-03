---
title: Tłumaczenie witryny dokumentacji
description: Ręczny, dwujęzyczny proces pracy nad angielskimi stronami źródłowymi i ich polskimi odpowiednikami w witrynie Docusaurus.
sidebar_label: Tłumaczenie dokumentacji
---

# Tłumaczenie witryny dokumentacji

Witryna Docusaurus w katalogu `docs/` udostępnia treści dla użytkowników **po angielsku i po
polsku**. Językiem roboczym repozytorium — kodu, specyfikacji i komunikatów commitów — pozostaje
angielski. Polską dokumentację **pisze się ręcznie**, w tym samym pull requeście co zmianę
angielską: ani CI, ani build produkcyjny nie zawierają kroku tłumaczenia maszynowego.

Ta strona opisuje proces tłumaczenia **witryny dokumentacji**. Pakiety tekstów panelu
administracyjnego (katalog `i18n/` każdego modułu, w katalogu głównym jego pakietu) to osobny
system — zobacz [Tłumaczenia panelu administracyjnego](./translations.md).

## Co trzeba przetłumaczyć

`pnpm --filter backend run check:docs-translations` wylicza wszystkie angielskie źródła i dla
każdego języka z `docs/locales.config.json` → `translateLocales` (w v1 tylko `pl`) oczekuje
przypiętego wpisu w pamięci tłumaczeń (cache) oraz gotowego pliku markdown:

| Warstwa | Źródło angielskie | Klucz `sourcePath` w cache |
| --- | --- | --- |
| Strony witryny pisane ręcznie | `docs/docs/**/*.md` (bez kategorii generowanych) | ścieżka względem katalogu głównego repozytorium, np. `docs/docs/intro.md` |
| Referencja modułów (generowana) | `docs/docs/module-reference/*.md` | `generated:module-reference/<slug>` |
| Mapa modułów (generowana) | `docs/docs/modules/module-map.generated.md` | ścieżka względem katalogu głównego repozytorium |
| Strony należące do modułów | `docs/**/*.md` w katalogu głównym pakietu każdego modułu | ścieżka względem katalogu głównego repozytorium |

Ścieżki wymienione w `docs/translation-skip.json` są pomijane (dziś jest to
`docs/docs/contributing/translations.md`, czyli słownik tłumaczeń panelu administracyjnego).

Elementy stałe witryny — pasek nawigacji, stopkę i etykiety **kategorii** paska bocznego
zadeklarowane w `docs/sidebars.js` i `docs/sidebars.modules.generated.js` — tłumaczy się w
plikach, z których Docusaurus je odczytuje, a tym plikiem **nie jest** `code.json`. Zasadę opisuje
następna sekcja. Pomyłka w tym miejscu niczego nie tłumaczy i niczego nie zgłasza — właśnie dlatego
cała polska nawigacja trafiła kiedyś na produkcję po angielsku.

## Gdzie należy identyfikator komunikatu

Każdy identyfikator komunikatu ma dokładnie jeden plik, z którego Docusaurus go odczyta. Wpisany
gdziekolwiek indziej nic nie robi: build się udaje, strona się wyświetla, a tekst zostaje w języku
źródłowym.

**Identyfikatory wyprowadzane z konfiguracji należą do plików tłumaczeń motywu i wtyczki.** To
identyfikatory, które Docusaurus wyprowadza z `themeConfig` w `docs/docusaurus.config.js` oraz z
`docs/sidebars.js`:

| Identyfikatory | Plik w `docs/i18n/<locale>/` |
| --- | --- |
| `title`, `logo.alt`, `item.label.<Label>` — pasek nawigacji | `docusaurus-theme-classic/navbar.json` |
| `copyright`, `logo.alt`, `link.title.<Title>`, `link.item.label.<Label>` — stopka | `docusaurus-theme-classic/footer.json` |
| `sidebar.<name>.category.<key>` wraz z `.link.generated-index.title` / `.description`, `sidebar.<name>.link.<key>` | `docusaurus-plugin-content-docs/current.json` |

`<key>` kategorii to `category.key ?? category.label`. Identyfikatory paska nawigacji i stopki
zapisuje się w ich własnych plikach **bez prefiksu** — `title`, nigdy `theme.navbar.title`.

**Identyfikatory emitowane przez komponenty należą do `code.json`.** To teksty, które wyświetlają
*komponenty* motywu i wtyczek — własne teksty motywu Docusaurus, takie jak
`theme.navbar.mobileLanguageDropdown.label`, oraz teksty wtyczki wyszukiwania.
`docs/i18n/<locale>/code.json` jest dla nich właściwym miejscem i nie zawiera niczego innego.

**`sidebar.<name>.doc.*` nie działa nigdzie.** Wpis w postaci samej ścieżki, `'some/doc'`, w
którymkolwiek pliku paska bocznego wtyczka content-docs normalizuje z `translatable: false`, więc
żaden taki identyfikator nie jest odczytywany z żadnego pliku. Polska etykieta dokumentu w pasku
bocznym pochodzi z tytułu samej polskiej strony — z `sidebar_label` albo `title` w jej front
matterze. Wpisy typu `doc` nie wymagają żadnego wpisu w pliku tłumaczeń.

`pnpm --filter backend run check:docs-translations` **wyprowadza** oczekiwany zbiór
identyfikatorów z obu plików konfiguracyjnych, a nie z listy
(`backend/scripts/lib/docs-chrome-messages.ts`). Nowa pozycja paska nawigacji albo nowa kategoria
zostaje więc zgłoszona przy pierwszym pojawieniu się — jako `chrome-message-missing`, gdy brakuje
jej we właściwym pliku, i jako `chrome-message-inert`, gdy trafiła do `code.json`.

## Edycja w trzech krokach

Postępuj tak, gdy zmieniasz jedną stronę angielską i jej polskie tłumaczenie. Kroki 1–2 to edycja
plików, krok 3 to lokalna kontrola.

1. **Zmień angielskie źródło** — stronę pisaną ręcznie w `docs/docs/` albo stronę w katalogu
   `docs/` modułu, w katalogu głównym jego pakietu (nie w `src/`).
2. **Napisz lub zaktualizuj polską wersję** w tym samym pull requeście:
   - Dodaj lub zaktualizuj wpis w `docs/translation-cache/pl/<sourceKey>.json` (ukośniki w
     ścieżce źródłowej zamieniają się w `--`, np. `docs/docs/intro.md` →
     `docs--docs--intro.md.json`).
   - Ustaw `sourceHash` na sha256 znormalizowanej **treści** strony angielskiej (bez front
     mattera YAML; zobacz `hashSourceBody()` w `backend/scripts/lib/docs-translation-cache.ts`).
   - Ustaw `content` na pełny polski markdown (front matter i treść).
   - Skopiuj `content` do pliku
     `docs/i18n/pl/docusaurus-plugin-content-docs/current/<docId>.md` (np. własny
     `docs/catalog.md` modułu `catalog` → `.../current/modules/catalog.md`).
   - Jeśli zmieniasz etykietę **kategorii** paska bocznego albo tekst paska nawigacji lub stopki,
     dodaj odpowiedni identyfikator do pliku wskazanego w sekcji *Gdzie należy identyfikator
     komunikatu* powyżej. Wpis **dokumentu** w pasku bocznym nie wymaga identyfikatora.
3. **Uruchom kontrolę kompletności**:

   ```bash
   pnpm --filter backend run check:docs-translations
   ```

   Kod wyjścia `0` oznacza, że każde źródło ma aktualny wpis w cache, gotowy plik, z którego
   Docusaurus potrafi odczytać tytuł, a każdy identyfikator elementów stałych jest w pliku, który
   go odczytuje. Kod wyjścia `2` wypisuje zgłoszenia `missing-translation`, `stale-translation`,
   `missing-sidebar-message`, `chrome-message-missing`, `chrome-message-inert` albo
   `doc-title-unresolvable`.

### Postać wpisu w cache

```json
{
  "sourcePath": "docs/docs/intro.md",
  "sourceHash": "<sha256 of English body>",
  "locale": "pl",
  "content": "---\ntitle: Wstęp\n---\n\n…",
  "meta": {
    "provider": "manual",
    "updatedAt": "2026-09-17T12:00:00.000Z"
  }
}
```

W polskim tekście zostaw bez zmian bloki kodu, kod w treści, adresy URL, ścieżki plików, polecenia
CLI, literały JSON/YAML, metody i ścieżki HTTP oraz identyfikatory modułów.

### Polska terminologia

Polskie strony pisz terminami z sekcji
[Terminologia witryny dokumentacji](./translations.md#documentation-site-terminology) — jeden
słownik obowiązuje panel administracyjny i tę witrynę, dzięki czemu moduł nakładkowy jest modułem
nakładkowym na każdej stronie, a nie tylko na niektórych. Tłumacz sens, a nie zdanie: polski szyk,
żadnych angielskich czasowników z polską końcówką i zapożyczenie tylko tam, gdzie słownik je
zostawia. Jeśli potrzebnego terminu brakuje, dodaj jego wiersz w tym samym pull requeście.

## Wygenerowane strony angielskie

`pnpm --filter backend run composer:generate` generuje **wyłącznie po angielsku**:

- strony referencji modułów w `docs/docs/module-reference/`,
- mapę modułów w `docs/docs/modules/module-map.generated.md`,
- wygenerowany fragment paska bocznego `docs/sidebars.modules.generated.js`.

Po ponownym wygenerowaniu **ręcznie odwzoruj wersję polską** w `docs/i18n/pl/`:

- wpisy w cache z kluczami `generated:module-reference/<slug>` (oraz ścieżką mapy modułów
  względem katalogu głównego repozytorium),
- gotowe pliki w `docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/` oraz
  `.../modules/`,
- identyfikator `sidebar.main.category.<key>` w
  `docs/i18n/pl/docusaurus-plugin-content-docs/current.json` dla każdej **nowej kategorii**
  zadeklarowanej w ponownie wygenerowanym `docs/sidebars.modules.generated.js`. Nowe wpisy typu
  `doc` niczego nie wymagają — ich polska etykieta to tytuł gotowej strony.

Nie zmieniaj wygenerowanych plików angielskich z myślą o wersji polskiej — aktualizuj drzewo i18n
i cache.

`pnpm --filter backend run docs:collect` (kopiuje strony angielskie do `docs/docs/modules/`) nie
zapisuje niczego po polsku; polską wersję językową w czasie budowania dostarczają pliki i18n
zatwierdzone w repozytorium.

## Weryfikacja dodatkowa

Gdy `check:docs-translations` przejdzie, sprawdź, czy budują się obie wersje językowe:

```bash
pnpm --filter docs run build
```

`onBrokenLinks: 'throw'` musi przejść zarówno dla wersji angielskiej, jak i polskiej.

## Dodawanie kolejnego języka

Kolejne języki się **dokłada** — bez przebudowy procesu. Aby dodać na przykład niemiecki:

1. Dopisz `"de"` do `locales` i `translateLocales` w `docs/locales.config.json`.
2. Dodaj `label` (i powiązane teksty motywu) dla `de` w `docs/docusaurus.config.js` →
   `i18n.localeConfigs`.
3. Przygotuj pliki tłumaczeń elementów stałych, kopiując pliki z `pl` i tłumacząc je —
   `docs/i18n/de/docusaurus-theme-classic/navbar.json` i `footer.json`,
   `docs/i18n/de/docusaurus-plugin-content-docs/current.json`, a także `docs/i18n/de/code.json`,
   wyłącznie dla identyfikatorów emitowanych przez komponenty (sekcja *Gdzie należy identyfikator
   komunikatu* powyżej).
4. Ręcznie napisz wpisy w `docs/translation-cache/de/` oraz gotowy markdown w
   `docs/i18n/de/docusaurus-plugin-content-docs/current/` dla każdego angielskiego źródła (te same
   warstwy i klucze co dla polskiego).
5. Uruchom `pnpm --filter backend run check:docs-translations` oraz
   `pnpm --filter docs run build` — oba muszą zakończyć się kodem `0`.

Wszystkie miejsca, które z tego korzystają (`check-docs-translations.ts`, konfiguracja Docusaurus,
przyszłe hooki), odczytują `loadDocsLocales()` z `docs/locales.config.json` — nie wpisuj kodów
języków na stałe w skryptach.

## Zobacz także

- [Tłumaczenia panelu administracyjnego](./translations.md) — polski słownik i proces pracy z
  pakietami `i18n/` każdego modułu.

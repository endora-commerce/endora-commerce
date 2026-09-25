---
title: i18n witryny dokumentacji
description: Ręczny dwujęzyczny workflow dla angielskich stron źródłowych i polskich materializacji w witrynie Docusaurus.
sidebar_label: i18n dokumentacji
---

# i18n witryny dokumentacji

Witryna Docusaurus w katalogu `docs/` udostępnia treści użytkownika **w języku angielskim i polskim**.
Język roboczy repozytorium dla kodu, specyfikacji i komunikatów commitów pozostaje angielski.
Polska dokumentacja jest **tworzona ręcznie**
w tym samym merge requeście co edycja angielska — w CI i buildach produkcyjnych nie ma kroku
tłumaczenia maszynowego.

Ta strona opisuje workflow **witryny dokumentacji**. Pakiety stringów UI panelu admina
(własny katalog `i18n/` każdego modułu, w katalogu głównym jego pakietu) to osobny system — zobacz
[Tłumaczenia UI panelu admina](./translations.md).

## Co trzeba tłumaczyć

`pnpm --filter backend run check:docs-translations` enumeruje każde
angielskie źródło i oczekuje przypiętego wpisu cache oraz zmaterializowanego pliku markdown
dla każdej lokalizacji z `docs/locales.config.json` → `translateLocales`
(w v1: tylko `pl`):

| Warstwa | Źródło angielskie | Klucz `sourcePath` w cache |
| --- | --- | --- |
| Ręcznie pisane strony witryny | `docs/docs/**/*.md` (z wyłączeniem wygenerowanych kategorii) | ścieżka względem repo, np. `docs/docs/intro.md` |
| Referencja modułów (generowana) | `docs/docs/module-reference/*.md` | `generated:module-reference/<slug>` |
| Mapa modułów (generowana) | `docs/docs/modules/module-map.generated.md` | ścieżka względem repo |
| Strony należące do modułów | `docs/**/*.md` w katalogu głównym pakietu każdego modułu | ścieżka względem repo |

Ścieżki z `docs/translation-skip.json` są wyłączone (obecnie:
`docs/docs/contributing/translations.md`, czyli słownik UI panelu admina).

Chrome — pasek nawigacji, stopka oraz etykiety **kategorii** sidebara zadeklarowane
w `docs/sidebars.js` i `docs/sidebars.modules.generated.js` — tłumaczy się w plikach,
z których Docusaurus je czyta, a tymi plikami **nie jest** `code.json`. Następna sekcja
opisuje tę zasadę; pomyłka w tym miejscu niczego nie tłumaczy i niczego nie sygnalizuje —
właśnie tak całe polskie chrome trafiło kiedyś na produkcję, renderując się po angielsku.

## Gdzie należy identyfikator wiadomości

Każdy identyfikator wiadomości ma dokładnie jeden plik, z którego Docusaurus go odczyta.
Wpisany gdziekolwiek indziej jest martwy: build się udaje, strona się renderuje,
a napis zostaje w języku źródłowym.

**Identyfikatory wyprowadzone z konfiguracji należą do plików tłumaczeń motywu i pluginu.**
To identyfikatory, które Docusaurus wyprowadza z `themeConfig` w
`docs/docusaurus.config.js` oraz z `docs/sidebars.js`:

| Identyfikatory | Plik w `docs/i18n/<locale>/` |
| --- | --- |
| `title`, `logo.alt`, `item.label.<Label>` — pasek nawigacji | `docusaurus-theme-classic/navbar.json` |
| `copyright`, `logo.alt`, `link.title.<Title>`, `link.item.label.<Label>` — stopka | `docusaurus-theme-classic/footer.json` |
| `sidebar.<name>.category.<key>` oraz jego `.link.generated-index.title` / `.description`, `sidebar.<name>.link.<key>` | `docusaurus-plugin-content-docs/current.json` |

`<key>` kategorii to `category.key ?? category.label`, a identyfikatory paska nawigacji
i stopki są kluczowane **wprost** we własnym pliku — `title`, nigdy `theme.navbar.title`.

**Identyfikatory emitowane przez komponenty należą do `code.json`.** To napisy emitowane
przez *komponenty* motywu i pluginów — własne stringi motywu Docusaurus, takie jak
`theme.navbar.mobileLanguageDropdown.label`, oraz stringi pluginu wyszukiwania.
`docs/i18n/<locale>/code.json` jest ich właściwym miejscem i nie zawiera niczego innego.

**`sidebar.<name>.doc.*` jest martwy wszędzie.** Goły wpis `'some/doc'` w którymkolwiek
pliku sidebara jest normalizowany przez plugin content-docs z `translatable: false`,
więc żaden taki identyfikator nie jest czytany z żadnego pliku: polska etykieta dokumentu
w sidebarze pochodzi z tytułu samej polskiej strony — z `sidebar_label` lub `title`
we front matterze zmaterializowanej strony. Wpisy typu `doc` nie wymagają żadnego wpisu
w pliku tłumaczeń.

`pnpm --filter backend run check:docs-translations` **wyprowadza** oczekiwany zbiór
identyfikatorów z dwóch plików konfiguracyjnych, a nie z listy
(`backend/scripts/lib/docs-chrome-messages.ts`), więc nowa pozycja paska nawigacji lub nowa
kategoria jest zgłaszana przy pierwszym pojawieniu — jako `chrome-message-missing`, gdy
brakuje jej we własnym pliku, i jako `chrome-message-inert`, gdy zamiast tego wylądowała
w `code.json`.

## Trzyetapowa sekwencja edycji

Użyj tej sekwencji, gdy zmieniasz jedną angielską stronę i jej polskie tłumaczenie.
Kroki 1–2 to edycje plików; krok 3 to lokalna kontrola.

1. **Edytuj angielskie źródło** — ręcznie pisana strona w `docs/docs/` albo
   własny katalog `docs/` modułu w korzeniu pakietu (nie pod `src/`).
2. **Napisz lub zaktualizuj polską materializację** w tym samym merge requeście:
   - Dodaj lub zaktualizuj wpis cache w
     `docs/translation-cache/pl/<sourceKey>.json` (ukośniki w ścieżce źródłowej
     stają się `--`, np. `docs/docs/intro.md` →
     `docs--docs--intro.md.json`).
   - Ustaw `sourceHash` na sha256 znormalizowanego angielskiego **body** (YAML
     front matter usunięty; zobacz `hashSourceBody()` w
     `backend/scripts/lib/docs-translation-cache.ts`).
   - Ustaw `content` na pełny polski markdown (front matter + body).
   - Skopiuj `content` do ścieżki materializacji
     `docs/i18n/pl/docusaurus-plugin-content-docs/current/<docId>.md`
     (np. własny `docs/catalog.md` modułu `catalog` →
     `.../current/modules/catalog.md`).
   - Jeśli zmieniłeś etykietę **kategorii** w sidebarze albo napis paska nawigacji
     lub stopki, dodaj pasujący identyfikator do pliku wskazanego w sekcji
     *Gdzie należy identyfikator wiadomości* powyżej. Wpis **dokumentu**
     w sidebarze nie wymaga żadnego identyfikatora.
3. **Uruchom kontrolę kompletności**:

   ```bash
   pnpm --filter backend run check:docs-translations
   ```

   Kod wyjścia `0` = każde źródło ma świeży wpis cache, zmaterializowany plik,
   z którego Docusaurus potrafi rozstrzygnąć tytuł, oraz każdy identyfikator chrome
   w pliku, który go czyta. Kod wyjścia `2` wypisuje ustalenia `missing-translation`,
   `stale-translation`, `missing-sidebar-message`, `chrome-message-missing`,
   `chrome-message-inert` lub `doc-title-unresolvable`.

### Kształt wpisu cache

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

Zachowaj bez zmian w polskiej prozie: bloki kodu, inline code, URL-e, ścieżki plików,
polecenia CLI, literały JSON/YAML, metody/ścieżki HTTP oraz identyfikatory modułów.

## Wygenerowane artefakty angielskie

`pnpm --filter backend run composer:generate` emituje **tylko angielski** dla:

- stron referencji modułów w `docs/docs/module-reference/`,
- mapy modułów w `docs/docs/modules/module-map.generated.md`,
- wygenerowanego fragmentu sidebara `docs/sidebars.modules.generated.js`.

Po regeneracji **ręcznie odwzoruj polski** w `docs/i18n/pl/`:

- wpisy cache z kluczami `generated:module-reference/<slug>` (oraz ścieżką mapy modułów
  względem repo),
- zmaterializowane pliki w
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/` oraz
  `.../modules/`,
- identyfikator `sidebar.main.category.<key>` w
  `docs/i18n/pl/docusaurus-plugin-content-docs/current.json` dla każdej **nowej
  kategorii** zadeklarowanej w zregenerowanym `docs/sidebars.modules.generated.js`.
  Nowe wpisy typu `doc` nie wymagają niczego — ich polska etykieta to tytuł samej
  zmaterializowanej strony.

Nie edytuj wygenerowanych plików angielskich pod kątem polskiego — zamiast tego aktualizuj
drzewo i18n oraz cache.

`pnpm --filter backend run docs:collect` (kopie angielskie do `docs/docs/modules/`)
nie zapisuje polskiego; zatwierdzone pliki i18n dostarczają polską lokalizację w czasie buildu.

## Opcjonalna weryfikacja

Po przejściu `check:docs-translations` potwierdź, że obie lokalizacje się budują:

```bash
pnpm --filter docs run build
```

`onBrokenLinks: 'throw'` musi przejść dla angielskiego i polskiego.

## Dodawanie przyszłej lokalizacji

Dodatkowe lokalizacje są **addytywne** — bez przebudowy pipeline'u. Aby dodać na przykład
niemiecki:

1. Dołącz `"de"` do `locales` i `translateLocales` w
   `docs/locales.config.json`.
2. Dodaj `label` (oraz powiązane stringi motywu) dla `de` w
   `docs/docusaurus.config.js` → `i18n.localeConfigs`.
3. Przygotuj pliki tłumaczeń chrome, kopiując te z `pl` i tłumacząc je —
   `docs/i18n/de/docusaurus-theme-classic/navbar.json` oraz `footer.json`,
   `docs/i18n/de/docusaurus-plugin-content-docs/current.json`, a także
   `docs/i18n/de/code.json` wyłącznie dla identyfikatorów emitowanych przez
   komponenty (sekcja *Gdzie należy identyfikator wiadomości* powyżej).
4. Ręcznie napisz wpisy cache w `docs/translation-cache/de/` oraz
   zmaterializowany markdown w
   `docs/i18n/de/docusaurus-plugin-content-docs/current/` dla każdego angielskiego
   źródła (te same warstwy i klucze co dla polskiego).
5. Uruchom `pnpm --filter backend run check:docs-translations` oraz
   `pnpm --filter docs run build` — oba muszą zakończyć się kodem `0`.

Wszyscy konsumenci (`check-docs-translations.ts`, konfiguracja Docusaurus, przyszłe hooki)
czytają `loadDocsLocales()` z `docs/locales.config.json` — nie hard-koduj kodów lokalizacji
w skryptach.

## Zobacz także

- [Tłumaczenia UI panelu admina](./translations.md) — polski słownik oraz
  workflow pakietów `i18n/` każdego modułu.

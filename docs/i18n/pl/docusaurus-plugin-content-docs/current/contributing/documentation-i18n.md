---
title: i18n witryny dokumentacji
description: Ręczny dwujęzyczny workflow dla angielskich stron źródłowych i polskich materializacji w witrynie Docusaurus.
sidebar_label: i18n dokumentacji
---

# i18n witryny dokumentacji

Witryna Docusaurus w katalogu `docs/` udostępnia treści użytkownika **w języku angielskim i polskim**.
Język roboczy repozytorium dla kodu, specyfikacji i komunikatów commitów pozostaje angielski
(Zasada VIII Konstytucji). Polska dokumentacja jest **tworzona ręcznie**
w tym samym merge requeście co edycja angielska — w CI i buildach produkcyjnych nie ma kroku
tłumaczenia maszynowego.

Ta strona opisuje workflow **witryny dokumentacji**. Pakiety stringów UI panelu admina
(`packages/modules/*/i18n/`) to osobny system — zobacz
[Tłumaczenia UI panelu admina](./translations.md).

## Co trzeba tłumaczyć

`pnpm --filter backend run check:docs-translations` (FR-022) enumeruje każde
angielskie źródło i oczekuje przypiętego wpisu cache oraz zmaterializowanego pliku markdown
dla każdej lokalizacji z `docs/locales.config.json` → `translateLocales`
(w v1: tylko `pl`):

| Warstwa | Źródło angielskie | Klucz `sourcePath` w cache |
| --- | --- | --- |
| Ręcznie pisane strony witryny | `docs/docs/**/*.md` (z wyłączeniem wygenerowanych kategorii) | ścieżka względem repo, np. `docs/docs/intro.md` |
| Referencja modułów (generowana) | `docs/docs/module-reference/*.md` | `generated:module-reference/<slug>` |
| Mapa modułów (generowana) | `docs/docs/modules/module-map.generated.md` | ścieżka względem repo |
| Strony należące do modułów | `packages/modules/<id>/docs/**/*.md` | ścieżka względem repo |

Ścieżki z `docs/translation-skip.json` są wyłączone (obecnie:
`docs/docs/contributing/translations.md`, czyli słownik UI panelu admina).

Etykiety kategorii i dokumentów z `docs/sidebars.js` oraz
`docs/sidebars.modules.generated.js` wymagają pasujących identyfikatorów wiadomości w
`docs/i18n/<locale>/code.json` (`sidebar.main.category.<key>`,
`sidebar.main.doc.<key>`).

## Trzyetapowa sekwencja edycji

Użyj tej sekwencji, gdy zmieniasz jedną angielską stronę i jej polskie tłumaczenie
(SC-006). Kroki 1–2 to edycje plików; krok 3 to lokalna kontrola.

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
     (np. `packages/modules/catalog/docs/catalog.md` →
     `.../current/modules/catalog.md`).
   - Jeśli zmieniłeś etykietę sidebara lub dodałeś wpis sidebara, dodaj pasujący
     klucz do `docs/i18n/pl/code.json`.
3. **Uruchom kontrolę kompletności**:

   ```bash
   pnpm --filter backend run check:docs-translations
   ```

   Kod wyjścia `0` = każde źródło ma świeży wpis cache, zmaterializowany plik i
   wiadomość sidebara. Kod wyjścia `2` wypisuje ustalenia `missing-translation`,
   `stale-translation` lub `missing-sidebar-message`.

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
polecenia CLI, literały JSON/YAML, metody/ścieżki HTTP oraz identyfikatory modułów (FR-007).

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
- nowe lub zmienione identyfikatory wiadomości sidebara w `docs/i18n/pl/code.json`.

Nie edytuj wygenerowanych plików angielskich pod kątem polskiego — zamiast tego aktualizuj
drzewo i18n oraz cache (FR-012, FR-014).

`pnpm --filter backend run docs:collect` (kopie angielskie do `docs/docs/modules/`)
nie zapisuje polskiego; zatwierdzone pliki i18n dostarczają polską lokalizację w czasie buildu.

## Opcjonalna weryfikacja

Po przejściu `check:docs-translations` potwierdź, że obie lokalizacje się budują:

```bash
pnpm --filter docs run build
```

`onBrokenLinks: 'throw'` musi przejść dla angielskiego i polskiego (FR-008).

## Dodawanie przyszłej lokalizacji (FR-025)

Dodatkowe lokalizacje są **addytywne** — bez przebudowy pipeline'u. Aby dodać na przykład
niemiecki:

1. Dołącz `"de"` do `locales` i `translateLocales` w
   `docs/locales.config.json`.
2. Dodaj `label` (oraz powiązane stringi motywu) dla `de` w
   `docs/docusaurus.config.js` → `i18n.localeConfigs`.
3. Przygotuj `docs/i18n/de/code.json` (skopiuj strukturę `pl` i przetłumacz
   wiadomości motywu + sidebara).
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
  workflow pakietów `packages/modules/*/i18n/` (feature 021).
- [`specs/conventions/module-documentation.md`](../../../specs/conventions/module-documentation.md)
  — gdzie przed tłumaczeniem żyją angielskie strony należące do modułów.

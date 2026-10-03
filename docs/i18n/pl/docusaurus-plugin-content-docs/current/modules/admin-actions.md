---
title: Akcje palety poleceń w panelu administracyjnym
description: Rejestr akcji dodawanych przez moduły do palety poleceń w panelu administracyjnym (⌘K, grupa Actions)
---

# Akcje palety poleceń w panelu administracyjnym

Punkt wpięcia oparty na rejestrze, który pozwala każdemu modułowi backendu dodawać przyciski akcji
do palety poleceń w panelu administracyjnym (okno `⌘K` / `Ctrl+K` — to, co operator widzi jako grupę
**Actions**). Żadna akcja nie jest wpisana na stałe: każda, łącznie z *New product* i *Import
products*, jest deklarowana raz, w manifeście modułu, do którego należy, i udostępniana przez ten
rejestr.

Częścią po stronie platformy jest ten moduł, `admin_actions`; część działająca w panelu
administracyjnym znajduje się w pakiecie `@endora-commerce/admin-shell`, w `src/lib/admin-actions/`.

## Co deklaruje moduł

`manifest.ts` modułu może deklarować zero lub więcej akcji, obok istniejących pól `settings` i
`i18n`:

```ts
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'catalog',
  name: 'Catalog',
  version: '1.4.0',
  dependencies: [],
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'new-product',
      labelKey: 'catalog.actions.newProduct.label',
      descriptionKey: 'catalog.actions.newProduct.description',
      icon: 'Plus',
      targetRoute: '/catalog/products/new',
      requiredPermission: 'catalog:write',
      keywords: ['product', 'new', 'add', 'create', 'produkt', 'nowy', 'dodaj'],
      weight: 100,
    },
  ],
});
```

Każdy wpis MUSI mieć stabilne `id`, tłumaczalny `labelKey`, `icon` z zamkniętej listy dozwolonych
ikon oraz `targetRoute`. Pola opcjonalne to `descriptionKey`, `requiredPermission`, `keywords` (do
10) i `weight` (domyślnie 100).

`requiredPermission` jest w schemacie opcjonalne, ale w praktyce obowiązkowe: musi to być **kod,
który backend egzekwuje na trasie stojącej za `targetRoute`**, żeby paleta nigdy nie proponowała
akcji kończącej się błędem 403 i nigdy nie ukrywała ekranu przed operatorem, który ma prawo go
otworzyć. Oba te błędy się zdarzyły — `settings/open-settings` trafił do wydania bez żadnego kodu,
choć prowadził do trasy chronionej przez `settings:read`, a `inventory/open-inventory` deklarował
`catalog:write` dla trasy chronionej przez `orders:read` — i przegląd uprawnień nie wykrył żadnego z
nich, bo sprawdza, czy kod jest egzekwowany *gdziekolwiek*, a nie czy jest egzekwowany *tutaj*.
`pnpm --filter backend run check:action-route-permissions` porównuje jedno z drugim, wiążąc
`targetRoute` aplikacji SPA z trasą API administracyjnego, która ją chroni. Zostaw to pole puste
tylko wtedy, gdy cel naprawdę nie jest niczym chroniony; jeśli ekran jest chroniony uprawnieniem do
odczytu, a etykieta akcji obiecuje zapis, pole nie może wyrazić obu tych rzeczy naraz, więc
rozbieżność jest zapisywana w rejestrze wyjątków tej kontroli, a nie zgadywana.

Unikalność `id` w obrębie modułu wymusza schemat Zod manifestu — instalacja manifestu z dwiema
akcjami o tym samym identyfikatorze kończy się błędem z czytelnym komunikatem wskazującym indeks.

## Publiczne API

| Metoda + ścieżka | Cel |
| --- | --- |
| `GET /api/v1/admin/admin-actions?language=<en\|pl>` | Zwraca listę akcji widocznych dla operatora, już przefiltrowaną według jego uprawnień i stanu instalacji modułów, posortowaną według `(weight, etykieta w kolejności właściwej dla języka)`, z etykietami i opisami w żądanym języku (z przejściem na angielski, a potem na surowy klucz — dokładnie tak jak w łańcuchu zastępczym i18n panelu administracyjnego). Uprawnienie: dowolny uwierzytelniony administrator. |

Odpowiedź zawiera pole `meta.registryVersion` — `MAX(version)` z widocznych wierszy — przydatne
diagnostycznie. Aplikacja panelu administracyjnego nie odpytuje go cyklicznie; odświeżenie następuje
po zmianie języka operatora i przy zamontowaniu komponentu.

## Jak operator widzi akcje

1. Operator otwiera panel administracyjny i naciska `⌘K` (lub `Ctrl+K` w systemach Windows i Linux).
2. Paleta pokazuje dwie grupy: **Navigate** (stałe skoki) i **Actions**.
3. Grupa Actions pokazuje każdą akcję, której moduł jest zainstalowany ORAZ której
   `requiredPermission` (jeśli jest ustawione) przyznaje rola operatora. Uprawnienie wieloznaczne
   `*`, które ma `platform_admin`, spełnia wymagania każdej akcji.
4. Wpisywanie tekstu w polu wyszukiwania filtruje **obie** grupy, dopasowując fragment tekstu do
   etykiety, opisu i słów kluczowych wiersza, bez rozróżniania wielkości liter i znaków
   diakrytycznych. Operator może wpisać `latwy`, żeby znaleźć `łatwy`, albo `import`, żeby znaleźć
   `Importuj produkty` itd.
5. Kliknięcie wiersza lub naciśnięcie `Enter` przenosi do `targetRoute` akcji i zamyka paletę.

Gdy operator nie widzi żadnej akcji (rzadko — tylko przy roli bez uprawnień i braku modułów
dodających akcje niewymagające uprawnień), grupa **Actions** jest całkowicie ukryta.

## Integracja z cyklem życia

Ścieżka instalacji w orkiestratorze uzgadnia `module_actions` po zainstalowaniu pakietu tłumaczeń
i18n, a przed hookiem instalacyjnym samego modułu. Mechanizm uzgadniający wstawia lub aktualizuje
(UPSERT) każdą zadeklarowaną akcję i usuwa wiersze, których nowy manifest już nie deklaruje —
kolejność instalacji, aktualizacje wersji i usuwanie akcji są idempotentne. Przy twardej
deinstalacji (`module:uninstall --hard`) mechanizm uzgadniający usuwa każdy wiersz akcji należący do
modułu przed krokiem usunięcia pakietu tłumaczeń i18n.

Stan jest przechowywany w `module_actions` (złożony klucz główny `(module_id, action_id)`); miękka
deinstalacja (stan → `disabled`) NIE usuwa wierszy — opiera się na filtrze widoczności przy odczycie,
który pomija każdy wiersz, którego moduł nie jest faktycznie obecny, co ukrywa akcje, ale zachowuje je
na wypadek ponownego włączenia.

Ten filtr pyta mechanizm łączący obie osie stanu w jądrze — przez sondę dostarczaną przez kompozycję
— i pyta o **obie** osie obecności: stan w `module_registrations` wdrożenia oraz ustawienie
aktywacji operatora. Kiedyś w ten sposób pytał tylko o drugą, a dla pierwszej łączył tabele po
`module_registrations.state = 'installed'`, co oznaczało, że paleta i zabezpieczenia tras
odczytywały odpowiedź na to samo pytanie z dwóch źródeł — rozbieżnych przez cały czas trwania
każdego `registryCache.refreshFromDb` — więc paleta mogła proponować akcję, której trasa odpowiadała
503, i ukrywać taką, którą trasa nadal by obsłużyła. Tabela rejestru nadal jest zapisem osi
platformy; paleta po prostu nie czyta jej już z pominięciem platformy.

## Struktura danych

| Kolumna | Typ | Uwagi |
| --- | --- | --- |
| `module_id` | `varchar(64)` | Część klucza głównego. |
| `action_id` | `varchar(64)` | Część klucza głównego. |
| `label_key` | `varchar(255)` | Klucz i18n tłumaczony przy odczycie. |
| `description_key` | `varchar(255) NULL` | Opcjonalny. |
| `icon` | `varchar(64)` | Jedna z nazw z zamkniętej listy dozwolonych ikon. |
| `target_route` | `varchar(255)` | Trasa w panelu administracyjnym. |
| `required_permission` | `varchar(64) NULL` | Kod uprawnienia, w dowolnej notacji. |
| `keywords` | `jsonb` | Tablica ciągów znaków. |
| `weight` | `integer` | Klucz sortowania (domyślnie 100). |
| `version` | `bigint` | Licznik dla wiersza; zwiększany przy każdym UPSERT. |
| `installed_at`, `updated_at` | `timestamptz` | Metadane wiersza. |

Na `module_id` nie ma klucza obcego — moduły wynikają z systemu plików, a `module_registrations`
jest rejestrem zapisu. Porządek utrzymuje ścieżka twardej deinstalacji w mechanizmie uzgadniającym,
tak samo jak w przypadku `translation_bundles`.

## Zalecane przedziały wag

Wagi są tylko zaleceniem, ale recenzenci oczekują, że nowe akcje trafią do właściwego przedziału:

| Przedział | Zastosowanie |
| --- | --- |
| 0–99 | Zarezerwowane dla powłoki platformy. |
| 100–199 | Podstawowe tworzenie (np. New product, New page, New post). |
| 200–299 | Drugorzędne tworzenie i wejścia do konfiguracji. |
| 300–399 | Akcje procesów i skrzynek odbiorczych. |
| 400–499 | Rzadziej używana nawigacja i narzędzia. |
| ≥ 500 | Rzadko używane akcje; trafiają na dół listy. |

## Lista dozwolonych ikon

Dozwolone nazwy ikon to typ wyliczeniowy w `packages/contracts/src/admin-actions.ts`. Dodanie nowej
ikony to jednowierszowa zmiana w tym typie i w `icon-map.ts` pakietu admin shell
(`@endora-commerce/admin-shell`, `src/lib/admin-actions/icon-map.ts`).

## Jakie akcje istnieją

Zestaw akcji to suma tablic `actions` z manifestów modułów zainstalowanych w Twojej instancji, więc
różni się między instancjami i ta strona go nie wymienia. Pierwsze wydanie zawierało dziesięć akcji
w dziewięciu modułach; dziś akcje deklaruje znacznie więcej modułów. Aby zobaczyć zestaw, który
instancja faktycznie udostępnia, wywołaj `GET /api/v1/admin/admin-actions` jako operator z
uprawnieniem `*` albo przeszukaj manifesty modułów pod kątem `actions:`.

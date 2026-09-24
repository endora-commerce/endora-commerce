---
title: Admin Command Palette Actions
description: Rejestr akcji modułów udostępniany w palecie poleceń Admin (⌘K, grupa Actions)
---

# Admin Command Palette Actions

Punkt współdzielenia oparty na rejestrze, który pozwala każdemu modułowi backendu dodawać
przyciski akcji do palety poleceń Admin UI (modal `⌘K` / `Ctrl+K` — to, co operator widzi
jako grupę **Actions**). Dziś na stałe są dostarczone dwie akcje (*New product*, *Import products*);
wszystkie one, i każda przyszła akcja, deklarowane są raz w manifeście
właścicielskiego modułu i udostępniane przez ten rejestr.

Strona platformy jest w `packages/modules/admin_actions/`, a runtime admina w
`admin/src/lib/admin-actions/`.

## Co moduł deklaruje

`manifest.ts` modułu może deklarować zero lub więcej akcji inline obok istniejących pól
`settings` i `i18n`:

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

Każdy wpis MUSI mieć stabilne `id`, tłumaczalne `labelKey`, `icon` z zamkniętej
allowlisty oraz `targetRoute`. Pola opcjonalne to `descriptionKey`, `requiredPermission`,
`keywords` (do 10) i `weight` (domyślnie 100).

`requiredPermission` jest opcjonalne w schemacie i praktycznie obowiązkowe: musi to być
**kod, który backend wymusza na trasie za `targetRoute`**, aby paleta nigdy nie reklamowała
403 i nigdy nie ukrywała ekranu przed operatorem uprawnionym do jego otwarcia. Oba błędy
się zdarzyły — `settings/open-settings` wyszedł bez kodu w ogóle na trasę `settings:read`,
a `inventory/open-inventory` deklarował `catalog:write` na trasę `orders:read` — i inwentaryzacja
uprawnień nie widziała żadnego z nich, bo przeszukuje, czy kod jest *egzekwowany gdzieś*,
a nie czy jest egzekwowany *tutaj*.
`pnpm --filter backend run check:action-route-permissions` porównuje oba, rozwiązując SPA
`targetRoute` do trasy admin API, która ją bramkuje. Zostaw pole puste tylko gdy cel
naprawdę nie ma bramki; gdy ekran jest read-gated, a etykieta akcji obiecuje write,
pole nie może powiedzieć obu naraz, a rozbieżność jest rejestrowana w ledgerze tego checka,
a nie zgadywana.

Unikalność `id` w obrębie modułu jest wymuszana schematem Zod manifestu — instalacja
manifestu z dwiema akcjami o tym samym id kończy się błędem z jasnym, indeksowanym komunikatem.

## Publiczne API

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/admin/admin-actions?language=<en\|pl>` | Zwraca widoczną dla operatora listę akcji, już przefiltrowaną po uprawnieniach operatora i stanie instalacji modułu, posortowaną według `(weight, locale-aware label)`, z etykietami i opisami rozwiązanymi w żądanym języku (fallback do angielskiego, potem do surowego klucza — identycznie jak łańcuch fallback Admin UI i18n). Uprawnienie: dowolny uwierzytelniony admin. |

Odpowiedź niesie pole `meta.registryVersion` — `MAX(version)` po widocznych wierszach —
przydatne diagnostycznie. Admin SPA nie polluje po nim; odświeżenia są sterowane zmianą
języka operatora i fetch-em przy mount.

## Jak operator widzi akcje

1. Operator otwiera Admin UI i naciska `⌘K` (lub `Ctrl+K` w Windows / Linux).
2. Paleta renderuje dwie grupy: **Navigate** (statyczne skoki) i **Actions**.
3. Grupa Actions pokazuje każdą akcję, której moduł właścicielski jest zainstalowany ORAZ
   której `requiredPermission` (jeśli jest) rola operatora przyznaje. Wildcard `*`
   trzymany przez `platform_admin` spełnia każdą akcję.
4. Wpisywanie w polu wyszukiwania filtruje **obie** grupy case-insensitive,
   diacritic-insensitive dopasowaniem substringu do etykiety, opisu i keywords wiersza.
   Polscy operatorzy mogą wpisać `latwy`, aby trafić `łatwy`, angielscy `import`, aby
   trafić `Importuj produkty` itd.
5. Kliknięcie wiersza lub `Enter` nawiguje do `targetRoute` akcji i zamyka paletę.

Gdy żadna akcja nie jest widoczna dla operatora (rzadko; tylko przy roli bez uprawnień
i bez modułów wnoszących akcje bez permission), grupa **Actions** jest ukryta w całości.

## Integracja z cyklem życia

Ścieżka install orchestratora uruchamia reconciliation `module_actions` między instalacją
bundle i18n a własnym hookiem install modułu. Reconciler UPSERT-uje każdą zadeklarowaną
akcję i przycina wiersze, których nowy manifest już nie deklaruje — kolejność instalacji,
upgrade wersji i usunięcia akcji są idempotentne. Przy hard-uninstall (`module:uninstall
--hard`) reconciler usuwa każdy wiersz akcji należący do modułu przed krokiem usunięcia
bundle i18n.

Stan jest trzymany w `module_actions` (złożony PK `(module_id, action_id)`); soft-
uninstall (stan → `disabled`) NIE usuwa wierszy — polega na filtrze widoczności read,
który ukrywa każdy wiersz, którego moduł nie jest skutecznie obecny, zachowując akcje
do ponownego włączenia.

Ten filtr pyta combiner effective-state kernela, przez probe, który wnosi composition
root, i pyta o **obie** osie obecności: stan `module_registrations` deploymentu oraz
Setting aktywacji operatora. Kiedyś pytał tylko o drugą w ten sposób i joinował
`module_registrations.state = 'installed'` dla pierwszej, co oznaczało, że paleta i bramki
tras czytały jedno pytanie z dwóch źródeł — rozjechane przez cały czas trwania każdego
`registryCache.refreshFromDb`, więc paleta mogła reklamować akcję, której trasa odpowiadała
503, i ukrywać taką, którą trasa nadal serwowałaby.
Tabela rejestru nadal jest zapisem osi platformy; paleta po prostu nie czyta jej już
za plecami platformy.

## Kształt storage

| Column | Type | Notes |
| --- | --- | --- |
| `module_id` | `varchar(64)` | Część PK. |
| `action_id` | `varchar(64)` | Część PK. |
| `label_key` | `varchar(255)` | Klucz i18n rozwiązywany przy read. |
| `description_key` | `varchar(255) NULL` | Opcjonalny. |
| `icon` | `varchar(64)` | Jedna z nazw z zamkniętej allowlisty. |
| `target_route` | `varchar(255)` | Trasa admin. |
| `required_permission` | `varchar(64) NULL` | Kod uprawnienia, dowolna notacja. |
| `keywords` | `jsonb` | Tablica stringów. |
| `weight` | `integer` | Klucz sortowania (domyślnie 100). |
| `version` | `bigint` | Sekwencja per wiersz; bump przy każdym UPSERT. |
| `installed_at`, `updated_at` | `timestamptz` | Metadane wiersza. |

Nie ma FK na `module_id` — moduły są filesystem-driven, a `module_registrations`
jest rejestrem zapisu. Cleanup wymusza ścieżka hard-uninstall reconcilera, na wzór wyboru
dla `translation_bundles`.

## Zalecane pasma weight

Wagi są doradcze, ale reviewerzy oczekują, że nowe akcje trafią w odpowiednie pasmo:

| Band | Use case |
| --- | --- |
| 0–99 | Zarezerwowane dla powłoki platformy. |
| 100–199 | Główne tworzenie (np. New product, New page, New post). |
| 200–299 | Drugorzędne tworzenie / wejścia konfiguracyjne. |
| 300–399 | Akcje workflow / inbox. |
| 400–499 | Rzadsza nawigacja / narzędzia. |
| ≥ 500 | Rzadko używane akcje; opadają na dół. |

## Allowlista ikon

Dozwolone nazwy ikon to enum w `packages/contracts/src/admin-actions.ts`. Dodanie nowej
ikony to jednowierszowy PR edytujący enum i admin `icon-map.ts`.

## Zestaw seed v1

Pierwsze wydanie dostarcza dziesięć akcji w dziewięciu modułach: `catalog/new-product`,
`import_export/import-products`, `import_export/open-import-export-center`,
`inventory/open-inventory`, `quote_requests/open-rfq-inbox`, `cms/new-page`,
`blog/new-post`, `megamenu/edit-megamenu`, `sales_channels/new-sales-channel`,
`settings/open-settings`. Osiem dalszych kandydatów ze specyfikacji odłożono, dopóki
docelowe strony admin nie istnieją (Adjust stock, New draft order, Find order by number,
New customer, New price list, New promotion, Upload asset, New category).

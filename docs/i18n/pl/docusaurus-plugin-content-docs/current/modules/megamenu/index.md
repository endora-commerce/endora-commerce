---
title: Megamenu
sidebar_position: 1
description: Konfigurowalne drzewo nawigacji z powiązaniami per kanał + język
---

# Megamenu

Moduł Megamenu posiada główną nawigację storefront. Wprowadza konfigurowalne drzewo pozycji menu tworzone w panelu admin, scope'owane do par `(sales channel × language)`, renderowane server-side na Next.js z pełno-szerokim panelem drop-down ujawnianym hover na desktop i stacked drill-down drawer na mobile.

## Encje i rodzaje pozycji

| Entity              | Identifier                          | Notes                                                  |
| ------------------- | ----------------------------------- | ------------------------------------------------------ |
| **Megamenu**        | `id` (uuid)                         | Wiersz konfiguracji — name, description, version.      |
| **MegamenuItem**    | `id` (uuid) + `parentId` (self-FK)  | Węzeł drzewa adjacency-list z `target` specyficznym dla kind. |
| **MegamenuBinding** | `(megamenuId, salesChannelId, language)` | Flaga `active` per scope egzekwowana partial unique index. |

Zamknięty zestaw rodzajów pozycji:

| `kind`            | Target shape                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `category-link`   | `{ categoryId, iconAssetId?, iconPosition? }`                         |
| `cms-page-link`   | `{ pageId, iconAssetId?, iconPosition? }`                             |
| `external-link`   | `{ url, iconAssetId?, iconPosition? }` (URL: `http\|https\|tel\|mailto`) |
| `button`          | `{ url, variant: 'primary'\|'secondary'\|'ghost' }`                   |
| `asset`           | `{ assetId, kind: 'image'\|'video' }`                                 |
| `cms-block-embed` | `{ blockId, embedSide: 'left'\|'right' }`                             |

Opcjonalny `iconAssetId` akceptuje tylko assety Library rodzaju `image`; validator odrzuca targety non-image.

## Kontrakt aktywacji (FR-008)

Co najwyżej jeden megamenu może być `active` per parę `(sales channel, language)` w dowolnym momencie. DB egzekwuje to przez:

```sql
CREATE UNIQUE INDEX megamenu_bindings_active_uniq
  ON megamenu_bindings (sales_channel_id, language)
  WHERE active = true;
```

Transakcja activate:

1. `UPDATE megamenu_bindings SET active = false WHERE sales_channel_id = ? AND language = ? AND active = true;` — dezaktywuje poprzedniego holdera (jeśli jest).
2. `UPDATE megamenu_bindings SET active = true WHERE megamenu_id = ? AND sales_channel_id = ? AND language = ?;` — aktywuje żądane powiązanie.

Obie działają w jednej transakcji, więc partial unique index nigdy nie widzi stanu dual-active. Endpoint activate zwraca poprzedniego holdera w `previouslyActive`, żeby dialog potwierdzenia admina mógł pokazać „przełączono z `<name>`”.

Activate odmawia na pustym drzewie z `400 MEGAMENU_EMPTY_TREE` (per `R10`). Usunięcie konfiguracji odmawia, gdy co najmniej jedno powiązanie ma `active = true`, z `409 MEGAMENU_HAS_ACTIVE_BINDINGS` (admini muszą najpierw dezaktywować per FR-004).

## Scope sales-channel + język

Konfiguracja może mieć wiele powiązań `(salesChannelId, language)`. Endpoint binding odmawia języka poza skonfigurowanym zestawem języków kanału z `400 MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`. Usunięcie powiązania fallbackuje do „brak megamenu” dla tego scope, dopóki inna konfiguracja nie aktywuje.

Fallback etykiety per język: gdy etykieta pozycji brakuje w żądanym języku, resolver storefront fallbackuje do domyślnego języka kanału. Pozycje bez etykiety w obu są cicho pomijane w rozwiązanym drzewie (admin widzi warning w edytorze).

## Głębokość drzewa (FR-011)

Głębokość drzewa to wytyczna UX, nie twardy constraint. Model danych nie nakłada cap. Formularz admin pokazuje nieblokujący warning po 4 poziomach:

```
meta.warnings: [{ code: "MEGAMENU_DEPTH_EXCEEDED", message: "..." }]
```

Zapis nadal się udaje; każdy poziom renderuje się na storefront.

## Ochrona referencji

Pozycje Megamenu trzymają miękkie referencje do encji upstream (Categories, CMS Pages, CMS Blocks, Library Assets). Usunięcie którejkolwiek z nich jest odrzucane, dopóki megamenu nadal się do nich odwołuje:

| Upstream entity | Registry / module                       | Match path on megamenu_items.target  |
| --------------- | --------------------------------------- | ------------------------------------ |
| Library Asset   | `AssetReferenceRegistry` (feature 013)  | `assetId` OR `iconAssetId`           |
| CMS Page        | `CmsReferenceRegistry` (feature 014)    | `kind='cms-page-link' AND pageId = ?` |
| CMS Block       | `CmsReferenceRegistry` (feature 014)    | `kind='cms-block-embed' AND blockId = ?` |
| Category        | (catalog category-reference registry)   | `kind='category-link' AND categoryId = ?` (planned) |

Każda rejestracja to jednolinijkowa zmiana powierzchni podpięta w `composition.ts`. Istniejące `findBlockReferences` / `findTemplateReferences` modułu CMS zostały rozszerzone w feature 015, żeby konsultować zewnętrzne skanery; `registerMegamenuCmsReferences` modułu megamenu rejestruje tam swój skaner.

Powierzchnia rejestru referencji kategorii jest planowana dla modułu catalog; dopóki nie wyląduje, ochrona delete kategorii przed referencjami megamenu jest egzekwowana na granicy validatora (megamenu nie może zapisać pozycji wskazującej usuniętą kategorię — check kategorii zwraca `false`, a admin widzi czytelny błąd).

## Rozwiązywanie storefront + cache Redis

Pojedynczy endpoint odczytu:

```
GET /api/v1/megamenu/by-channel?language=<bcp-47>
X-Sales-Channel: <channel-code>
```

Resolver:

1. Szuka aktywnego powiązania przez partial unique index (1 query).
2. Czyta każdą pozycję pod tym megamenu w kolejności `(parent_id, position)` (1 query).
3. Przechodzi drzewo, dispatchując po `kind`: rozwiązuje URL Category / CMS-page ze slugów, podpisuje URL Asset przez Assets Library, inline'uje CMS Blocks przez storefront resolver modułu CMS, wypełnia ikony.
4. Zwraca rekursywny payload `ResolvedMegamenu`.

Rozwiązane payloady są cache'owane w Redis pod `megamenu:v1:<channel>:<language>` z TTL 5 minut. Invalidacja:

- `POST /menus`, `PATCH /menus/:id`, `PUT /menus/:id/items`, `DELETE /menus/:id` → coarse drop `megamenu:v1:*` (jedno menu może obsługiwać N powiązań).
- `POST /menus/:id/bindings` / `DELETE /menus/:id/bindings/:channel/:language` → drop dotkniętego scope.
- `POST /menus/:id/activate` / `POST /menus/:id/deactivate` → drop aktywowanego/dezaktywowanego scope.

Implementacja cache mirror'uje `CmsCache` z feature 014 dokładnie (ten sam schemat prefiksu, ten sam TTL, ta sama invalidacja oparta na SCAN).

## Renderowanie storefront

### Desktop

Odtwarza panel `.mega` z designu Industria: pełno-szeroki drop-down pod paskiem nav, otwierany hover (`onMouseEnter`) i zamykany `onMouseLeave`. Panel używa siatki 3-kolumnowej `220px 1fr 280px` z `gap: 32px` i `padding: 28px 0`. Trzecia kolumna jest wypełniana przez pierwsze dziecko `cms-block-embed` z `embedSide === 'right'` (embed `left` pojawia się w kolumnie 1, przesuwając siatkę linków w prawo).

### Mobile

Trigger burger renderuje się poniżej `768px`. Tap otwiera stacked drill-down drawer; tap rodzica przesuwa do następnego poziomu przez stan komponentu z affordance „Back”. Osadzone CMS Blocks, Buttons i Assets renderują się stacked inline (bez layoutu off-canvas side-by-side). Natywne scroll restoration przeglądarki pokrywa wymóg „zachowuje scroll na poziomach rodzica”.

## Powierzchnia HTTP

### Admin (`/api/v1/admin/megamenu`)

| Method  | Path                                                        | Purpose                                              |
| ------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| GET     | `/menus`                                                    | Lista konfiguracji z liczbami powiązań.              |
| POST    | `/menus`                                                    | Utworzenie Megamenu (bez pozycji, bez powiązań).     |
| GET     | `/menus/:id`                                                | Szczegóły z drzewem + powiązaniami.                  |
| PATCH   | `/menus/:id`                                                | Edycja metadanych. Respektuje `If-Match` przez `version`. |
| DELETE  | `/menus/:id`                                                | Odmowa, gdy jakiekolwiek powiązanie ma `active = true`. |
| PUT     | `/menus/:id/items`                                          | Zapis całego drzewa pozycji (full overwrite).         |
| GET     | `/menus/:id/bindings`                                       | Lista każdego powiązania konfiguracji.               |
| POST    | `/menus/:id/bindings`                                       | Dodanie powiązania `(channel, language)` (zawsze staged). |
| DELETE  | `/menus/:id/bindings/:salesChannelId/:language`             | Usunięcie powiązania (idempotent).                   |
| POST    | `/menus/:id/activate`                                       | Atomowa zamiana aktywacji.                           |
| POST    | `/menus/:id/deactivate`                                     | Dezaktywacja powiązania.                             |

### Storefront (`/api/v1/megamenu`)

| Method | Path                              | Returns                                                                 |
| ------ | --------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/by-channel?language=…`          | Rozwiązany megamenu dla żądanego scope; `404 MEGAMENU_NOT_FOUND`, gdy brak aktywnego powiązania. |

## Migracja z no-megamenu

Migracja `036_megamenu_init.ts` dodaje trzy nowe tabele i partial unique index. Nie ma seedowanych wierszy; admini first-time tworzą konfigurację przez UI admina.

Zamontowany w root layout storefront między `<Header>` a istniejącym Hookiem `header.bottom`. Integracja CMS Hooks z feature 014 pozostaje nienaruszona.

## Kody błędów

`MEGAMENU_NOT_FOUND`, `MEGAMENU_HAS_ACTIVE_BINDINGS`, `MEGAMENU_EMPTY_TREE`, `MEGAMENU_BINDING_NOT_FOUND`, `MEGAMENU_BINDING_ALREADY_EXISTS`, `MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `MEGAMENU_TARGET_OUT_OF_SCOPE`, `MEGAMENU_ASSET_KIND_MISMATCH`, `MEGAMENU_REFERENCED`, `MEGAMENU_DEPTH_EXCEEDED`.

Wszystkie envelope'y stosują platformowy kontrakt błędów w `packages/contracts/src/errors.ts`.

## Poza zakresem (v1)

- Warianty megamenu per customer-group / organization.
- A/B testing wariantów menu.
- Powierzchnia admin „preview bez publikacji”.
- Targety URL pozycji wskazujące bezpośrednio PDP produktu (użyj linku Category lub External link).
- Pozycje asset free-URL: server-side `importFromUrl` na Assets Library to naturalny dom dla pobierania, walidacji i przechowywania zewnętrznych bajtów; validator modułu Megamenu odmawia pozycji asset free-URL, dopóki ta powierzchnia nie wyląduje. Admini uploadują asset przez Library najpierw i odwołują się po id.
- Drag-and-drop autoring drzewa w admin: edytor v1 używa kontrolek strzałek up/down/delete/add-child. `@dnd-kit` nie jest bundlowany w aplikacji admin, a brief kładzie nacisk na edycję drzewa, nie na gest sophistication.

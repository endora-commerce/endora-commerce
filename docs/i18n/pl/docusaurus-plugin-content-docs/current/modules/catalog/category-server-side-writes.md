---
title: Zapis kategorii z kodu serwerowego
---

# Zapis kategorii z kodu serwerowego

Inny moduł, moduł nakładki (overlay) lub proces integracji (konektor PIM lub
ERP) zapisuje kategorię przez **`catalogCategoryCommandPort`** — port zapisu
agregatu kategorii, zadeklarowany jako `CatalogCategoryCommandPort` w
`@endora-commerce/contracts`. Nigdy nie zapisuje sam tabeli `categories`.
Pobieraj go przy każdym użyciu przez
`lazyPort<CatalogCategoryCommandPort>(ctx, 'catalogCategoryCommandPort')`, z
modułem `catalog` w `dependencies` manifestu modułu wywołującego.

| Metoda | Akcja w dzienniku audytu | Co tak samo robi panel administracyjny |
| --- | --- | --- |
| `create(input, options?)` | `category.create` | `POST /api/v1/admin/catalog/categories` |
| `update(id, input, options?)` | `category.update` | `PATCH /api/v1/admin/catalog/categories/:id` |
| `move(id, { parentId, position? }, options?)` | `category.update` | ten sam `PATCH` z kategorią nadrzędną i kolejnością |
| `delete(id, options?)` | `category.delete` | `DELETE /api/v1/admin/catalog/categories/:id` |
| `setCustomFieldValues(id, merge, options?)` | `category.update` | ten sam `PATCH` z samymi wartościami pól własnych |
| `setInventoryThresholds(id, { high?, medium?, low? }, options?)` | `category.inventory_thresholds.set` | wiersze kategorii w `PATCH /api/v1/admin/inventory/thresholds` |

Do odczytu kategorii — drzewa, jednej kategorii, jej przodków — służy
`catalogCategoryReadPort`.

## Jedna ścieżka zapisu

Każda metoda wykonuje to samo polecenie (Command) co punkt końcowy panelu,
zbudowane tym samym kodem, więc oba nie mogą zapisać inaczej: jeden wpis w
dzienniku audytu z tym samym stanem i to samo zdarzenie. Gdy kategoria zostanie
zmieniona lub przeniesiona albo zmienią się jej wartości pól własnych, nawigacja
kategorii w sklepie jest odświeżana, a produkty z poddrzewa kategorii są
ponownie indeksowane w wyszukiwarce — dokładnie tak jak po edycji w panelu.
Utworzona kategoria trafia do domyślnego kanału sprzedaży, jeśli nie należy do
żadnego, tak jak z panelu.

Dane wejściowe to treści żądań tych punktów końcowych, sprawdzane według tych
samych reguł; odmowy to błędy tych punktów końcowych z ich kodami:

- `422 VALIDATION_FAILED` — dane spoza reguł punktu końcowego, na przykład
  slug, który nie składa się z małych liter i cyfr połączonych łącznikami;
- `404 NOT_FOUND` — nieznana lub usunięta kategoria albo kategoria nadrzędna;
- `409 CATEGORY_SLUG_TAKEN` — slug jest już użyty pod tą kategorią nadrzędną;
- `409 CATEGORY_MOVE_CYCLE` — nowa kategoria nadrzędna jest tą samą kategorią
  lub jednym z jej potomków;
- `409 CATEGORY_HAS_CHILDREN` — `delete` kategorii, która ma jeszcze
  podkategorie;
- `422 CUSTOM_FIELD_VALUE_INVALID` — wartość pola własnego odrzucona przez
  definicję pola, przy `create` i `update`.

## Kto zapisał

Wykonawcą jest ten z bieżącego kontekstu, nigdy parametr: administrator w
żądaniu panelu albo w `withSystemScopeActingFor`; wykonawca **systemowy** w
`withSystemScope` w procesie w tle, który nie zapisuje żadnego administratora.
Bez żadnego kontekstu dzierżawy (tenant) zapis jest odrzucany, zanim cokolwiek
zostanie zapisane. Port nie sprawdza uprawnień — to wywołujący pilnuje dostępu —
więc nigdy nie używaj go w trasie dostępnej dla klienta.

## Opcje

Ostatni parametr każdej metody:

- `source` — kod z małych liter nazywający integrację (`pim`, `pim.categories`,
  najwyżej 64 znaki), zapisywany jako `source` we wpisie dziennika obok
  wykonawcy. To po nim rozróżnisz dwie integracje, gdy obie piszą jako system.
  Każda inna wartość jest odrzucana z `422 VALIDATION_FAILED`, zanim cokolwiek
  zostanie odczytane lub zapisane.
- `expectedVersion` — ignorowane: kategoria nie ma wersji.
- `extensions` — dane dla hooków poleceń (command hooks). Żadna akcja kategorii
  nie przyjmuje jeszcze hooków, więc każdy klucz jest odrzucany z
  `422 COMMAND_EXTENSION_UNCLAIMED`, zanim cokolwiek zostanie zapisane.

## Przenoszenie, pola własne i progi

**Przenoszenie.** `move` ustawia kategorię nadrzędną — `null` czyni kategorię
główną — oraz, jeśli podasz `position`, kolejność, według której drzewo
porządkuje rodzeństwo. To ta sama edycja dwóch pól co w panelu, więc jest
zapisywana jako `category.update`.

**Pola własne.** `setCustomFieldValues` wczytuje kategorię, wywołuje Twoją
funkcję `merge` z kopią bieżących wartości i zapisuje to, co `merge` zwróci —
w jednym zapisie. Nie sprawdza wartości: wywołaj
`CustomFieldValuePort.validateAndMerge` wewnątrz `merge`, a błąd, który zgłosi,
dotrze do Ciebie bez zmian i nic nie zostanie zapisane. Jest zapisywana jako
`category.update`, tak jak edycja w panelu, więc hook polecenia na tej akcji
widzi obie.

**Progi magazynowe.** `setInventoryThresholds` ustawia trzy progi pasm
wyświetlania stanu magazynowego kategorii. Pominięty klucz zostaje bez zmian, a
`null` usuwa własną wartość kategorii. Wywołanie, które niczego nie zmienia,
niczego nie zapisuje w dzienniku. Ekran progów modułu Inventory zapisuje wiersze
kategorii przez tę metodę, a jego własny wpis `low_stock_threshold.update`
obejmuje już tylko progi globalne i progi produktów.

## Czego port nie oferuje

Treści strony kategorii (ma własny ekran), importu kategorii (import zbiorczy),
przypisywania produktów do kategorii (to edycja produktu) ani kanałów sprzedaży
kategorii poza domyślnym nadawanym przy tworzeniu.

## Wcześniejszy port

`catalogCategoryWritePort` jest **przestarzały od wersji 0.113.0** i zostanie
usunięty w jednej z kolejnych wersji. Każda metoda nadal działa i zapisuje te
same wpisy:

| Stare wywołanie | Nowe wywołanie |
| --- | --- |
| `catalogCategoryWritePort.listAll()` | `catalogCategoryReadPort.listAll({ liveOnly: true })` |
| `catalogCategoryWritePort.create(input)` | `catalogCategoryCommandPort.create(input, options?)` |
| `catalogCategoryWritePort.update(id, input)` | `catalogCategoryCommandPort.update(id, input, options?)` |
| `catalogCategoryWritePort.setInventoryThresholds(id, patch)` | `catalogCategoryCommandPort.setInventoryThresholds(id, patch, options?)` |

Dwie różnice przy przejściu: nowe `create` i `update` sprawdzają dane wejściowe
według reguł punktu końcowego panelu, czego stare metody nie robiły; a od wersji
0.113.0 zmiana progów jest zapisywana jako `category.inventory_thresholds.set`,
niezależnie od portu.

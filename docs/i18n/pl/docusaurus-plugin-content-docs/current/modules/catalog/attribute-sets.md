---
title: Zestawy atrybutów
---

# Zestawy atrybutów

Zestawy atrybutów grupują definicje `ProductAttribute` w schematy wielokrotnego użytku. Każdy
produkt jest przypisany do dokładnie jednego zestawu; system dostarcza zestaw `default`, używany,
gdy administrator nie wybierze innego.

## Po co są

Bez zestawów każdy produkt miałby w `attributeValues` pełny zestaw atrybutów. Różne rodzaje
produktów (elektronika, odzież, chemia) potrzebują różnych atrybutów, a podstawowy schemat
traktował każdy klucz jako globalny. Zestawy pozwalają administratorom przygotować dla każdej
kategorii formularz z tylko potrzebnymi polami, a storefrontowi — wyświetlić krótszą tabelę
atrybutów.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attribute-sets` | administrator | Lista wszystkich zestawów, łącznie z `default` |
| `GET /api/v1/admin/catalog/attribute-sets/:id` | administrator | Szczegóły zestawu z przypisanymi atrybutami |
| `POST /api/v1/admin/catalog/attribute-sets` | administrator | Utworzenie własnego zestawu (`code` w snake_case, unikalny) |
| `PATCH /api/v1/admin/catalog/attribute-sets/:id` | administrator | Zmiana nazwy; systemowego zestawu Default nie można zmieniać |
| `DELETE /api/v1/admin/catalog/attribute-sets/:id` | administrator | Usunięcie; odrzucane z 409, gdy zestawu używa jakikolwiek produkt |
| `POST /api/v1/admin/catalog/attribute-sets/:id/attributes` | administrator | Przypisanie atrybutów do zestawu |
| `DELETE /api/v1/admin/catalog/attribute-sets/:id/attributes/:key` | administrator | Odłączenie atrybutu |

Treść żądania tworzenia i aktualizacji produktu przyjmuje `attributeSetId`. Gdy go nie podano,
używany jest systemowy zestaw Default.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `ATTRIBUTE_SET_CODE_TAKEN` | 409 | `code` już istnieje |
| `ATTRIBUTE_SET_IN_USE` | 409 | Usunięcie zablokowane: zestawu używa co najmniej jeden produkt |
| `SYSTEM_ATTRIBUTE_SET_IMMUTABLE` | 409 | Próba zmiany zestawu Default utworzonego przy instalacji |
| `ATTRIBUTE_SET_NOT_FOUND` | 404 | Brak `:id` |
| `ATTRIBUTE_NOT_FOUND` | 404 | Brak `:key` przy przypisaniu |

## Storefront

`productDetail.attributeSet` zawiera `{id, code, name}`, aby motywy mogły wyświetlić nazwę zestawu
nad tabelą atrybutów. Motyw wzorcowy wyświetla przetłumaczoną nazwę zestawu jako niewielki
podtytuł.

## Przechowywanie

`attribute_sets` (id, unikalny code, name jsonb, is_system bool) i `attribute_set_attributes`
(złożony klucz główny (set_id, attribute_id)). Systemowy wiersz Default tworzy migracja
`20260429T064146_catalog_attribute_sets_init.ts` ze stałym
UUID `defa0017-0000-4000-8000-000000000000`, aby dane początkowe i testy mogły się do niego
niezmiennie odwoływać.

## Dziennik audytu

Każda zmiana zestawu atrybutów zapisuje jeden `AuditLogEntry` ze `stateBefore` i `stateAfter`, aby
strona audytu pokazywała, kto co zmienił.

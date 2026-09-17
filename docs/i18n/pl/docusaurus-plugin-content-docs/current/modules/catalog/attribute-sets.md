---
title: Zestawy atrybutów
---

# Zestawy atrybutów

Zestawy atrybutów grupują definicje `ProductAttribute` w wielokrotnie używane
schematy. Każdy produkt jest podpięty do dokładnie jednego zestawu; system
dostarcza zestaw `default`, który stosuje się, gdy admini nie wybiorą innego.

## Po co istnieją

Bez zestawów każdy produkt niósłby pełny graf atrybutów w `attributeValues`.
Różne typy produktów (elektronika, odzież, chemia) potrzebują różnych
atrybutów, ale schemat foundation 001 traktował każdy klucz jako globalny.
Feature 002 wprowadza zestawy, żeby admini mogli kuratorować skupione doświadczenie
autorskie per kategoria, a storefront renderował ciaśniejszą tabelę atrybutów.

## Publiczne API

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attribute-sets` | admin | Lista wszystkich zestawów łącznie z `default` |
| `GET /api/v1/admin/catalog/attribute-sets/:id` | admin | Szczegóły zestawu z przypisanymi atrybutami |
| `POST /api/v1/admin/catalog/attribute-sets` | admin | Utworzenie własnego zestawu (`code` snake_case, unikalny) |
| `PATCH /api/v1/admin/catalog/attribute-sets/:id` | admin | Aktualizacja nazwy; systemowy Default jest niemutowalny |
| `DELETE /api/v1/admin/catalog/attribute-sets/:id` | admin | Usunięcie; odrzuca z 409, gdy jakikolwiek produkt odwołuje się do zestawu |
| `POST /api/v1/admin/catalog/attribute-sets/:id/attributes` | admin | Przypisanie atrybutów do zestawu |
| `DELETE /api/v1/admin/catalog/attribute-sets/:id/attributes/:key` | admin | Odpięcie |

Payload tworzenia/aktualizacji produktu akceptuje `attributeSetId`. Gdy pominięty,
używany jest systemowy Default Set.

## Błędy

| Code | Status | Kiedy |
| --- | --- | --- |
| `ATTRIBUTE_SET_CODE_TAKEN` | 409 | `code` już istnieje |
| `ATTRIBUTE_SET_IN_USE` | 409 | Usunięcie zablokowane: co najmniej jeden produkt odwołuje się do zestawu |
| `SYSTEM_ATTRIBUTE_SET_IMMUTABLE` | 409 | Mutacja seedowanego Default Set |
| `ATTRIBUTE_SET_NOT_FOUND` | 404 | Brak `:id` |
| `ATTRIBUTE_NOT_FOUND` | 404 | Brak `:key` przy przypisaniu |

## Integracja ze storefrontem

`productDetail.attributeSet` niesie `{id, code, name}`, żeby motywy mogły
renderować etykietę zestawu nad tabelą atrybutów. Motyw referencyjny foundation
renderuje zlokalizowaną nazwę zestawu jako mały podnagłówek.

## Magazynowanie

`attribute_sets` (id, code unique, name jsonb, is_system bool) +
`attribute_set_attributes` (composite PK na (set_id, attribute_id)).
Systemowy wiersz Default jest seedowany migracją 017 ze deterministycznym UUID
`defa0017-0000-4000-8000-000000000000`, żeby seedy i testy mogły się do niego
odwoływać stabilnie.

## Dziennik audytu

CRUD AttributeSet zapisuje jeden `AuditLogEntry` na mutację z `stateBefore` i
`stateAfter`, żeby strona audytu pokazywała, kto co zmienił.

---
title: Załączniki produktu
---

# Załączniki produktu

Załączniki produktu to pliki do pobrania (certyfikaty, specyfikacje techniczne,
karty produktu, generyczne PDF-y) przypięte do produktu. Opakowują bazowy wiersz
`Asset`, więc ten sam plik można powiązać z wieloma produktami bez duplikacji —
wiersz `assets` przeżywa nawet usunięcie załącznika.

## Typy załączników

Słownik `attachment_types` kategoryzuje załączniki. Migracja 021 seeduje cztery
standardowe wiersze ze deterministycznymi UUID, żeby seedy i testy mogły się do
nich odwoływać stabilnie:

- `certificate` — Certificate / Certyfikat
- `tech_spec` — Technical specification / Specyfikacja techniczna
- `product_card` — Product card / Karta produktu
- `pdf` — generyczny PDF

Admini mogą dodawać własne typy przez stronę **Attachment Types** w panelu
admina. Usunięcie typu, do którego nadal odwołuje się jakiś produkt, zwraca
`409 ATTACHMENT_TYPE_IN_USE`.

## Publiczne API

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attachment-types` | admin | Lista typów z licznikami użycia |
| `POST /api/v1/admin/catalog/attachment-types` | admin | Utworzenie własnego typu |
| `PATCH /api/v1/admin/catalog/attachment-types/:id` | admin | Aktualizacja nazwy / pozycji |
| `DELETE /api/v1/admin/catalog/attachment-types/:id` | admin | Usunięcie; odrzuca gdy w użyciu |
| `GET /api/v1/admin/catalog/products/:id/attachments` | admin | Lista załączników produktu |
| `POST /api/v1/admin/catalog/products/:id/attachments` | admin | Dołączenie istniejącego Asset |
| `PATCH /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | admin | Aktualizacja nazwy / opisu / typu / pozycji |
| `DELETE /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | admin | Usunięcie (Asset przeżywa) |

## Błędy

| Code | Status | Kiedy |
| --- | --- | --- |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Asset załącznika musi być `pdf`, `certificate` lub `other` (image/video tylko w galerii) |
| `ATTACHMENT_TYPE_IN_USE` | 409 | Usunięcie zablokowane przez użycie |
| `ATTACHMENT_TYPE_CODE_TAKEN` | 409 | Kolizja `code` przy tworzeniu |
| `ATTACHMENT_TYPE_NOT_FOUND` | 404 | Brak `:id` |
| `ATTACHMENT_NOT_FOUND` | 404 | Brak `:attachmentId` |

## Integracja ze storefrontem

`productDetail.attachments[]` niesie pełne metadane typu i Asset (filename,
sizeBytes, mimeType, url). Komponent `<AttachmentsList>` grupuje według
AttachmentType (zachowując kolejność first-seen, żeby pozycje ustawione przez
admina kształtowały kolejność sekcji), renderuje jeden nagłówek na typ i emituje
kotwice pobierania z `download={filename}` dla czystych nazw plików.

## Magazynowanie

`attachment_types` (id, code unique, name jsonb, position) +
`product_attachments` (id, product_id FK CASCADE, asset_id FK RESTRICT,
attachment_type_id FK RESTRICT, name, description, position).

Foundation nie ma publicznego `AssetsService` — katalog używa bezpośrednich
importów encji `Asset` między modułami. UI uploadu Asset w adminie to follow-up
na poziomie foundation; do tego czasu admini wklejają istniejące id asset przy
tworzeniu załącznika.

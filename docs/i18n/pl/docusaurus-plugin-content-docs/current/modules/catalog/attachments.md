---
title: Załączniki produktu
---

# Załączniki produktu

Załączniki produktu to pliki do pobrania (certyfikaty, specyfikacje techniczne, karty produktu,
inne pliki PDF) przypisane do produktu. Odwołują się do wiersza `Asset`, więc ten sam plik można
powiązać z wieloma produktami bez powielania — wiersz `assets` pozostaje nawet po usunięciu
załącznika.

## Typy załączników

Słownik `attachment_types` dzieli załączniki na kategorie. Migracja `20260429T112543_catalog_product_attachments.ts` tworzy cztery standardowe
wiersze o stałych UUID, aby dane początkowe i testy mogły się do nich niezmiennie odwoływać:

- `certificate` — Certificate / Certyfikat
- `tech_spec` — Technical specification / Specyfikacja techniczna
- `product_card` — Product card / Karta produktu
- `pdf` — dowolny plik PDF

Administratorzy mogą dodawać własne typy na stronie **Attachment Types** w panelu
administracyjnym. Usunięcie typu, którego nadal używa jakiś produkt, zwraca
`409 ATTACHMENT_TYPE_IN_USE`.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attachment-types` | administrator | Lista typów z liczbą użyć |
| `POST /api/v1/admin/catalog/attachment-types` | administrator | Utworzenie własnego typu |
| `PATCH /api/v1/admin/catalog/attachment-types/:id` | administrator | Zmiana nazwy lub pozycji |
| `DELETE /api/v1/admin/catalog/attachment-types/:id` | administrator | Usunięcie; odrzucane, gdy typ jest używany |
| `GET /api/v1/admin/catalog/products/:id/attachments` | administrator | Lista załączników produktu |
| `POST /api/v1/admin/catalog/products/:id/attachments` | administrator | Dołączenie istniejącego pliku |
| `PATCH /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | administrator | Zmiana nazwy, opisu, typu lub pozycji |
| `DELETE /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | administrator | Usunięcie (plik pozostaje) |

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Plik załącznika musi być rodzaju `pdf`, `certificate` lub `other` (zdjęcia i filmy tylko w galerii) |
| `ATTACHMENT_TYPE_IN_USE` | 409 | Usunięcie zablokowane, bo typ jest używany |
| `ATTACHMENT_TYPE_CODE_TAKEN` | 409 | Kolizja `code` przy tworzeniu |
| `ATTACHMENT_TYPE_NOT_FOUND` | 404 | Brak `:id` |
| `ATTACHMENT_NOT_FOUND` | 404 | Brak `:attachmentId` |

## Storefront

`productDetail.attachments[]` zawiera pełne metadane typu i pliku (filename, sizeBytes, mimeType,
url). Komponent `<AttachmentsList>` grupuje załączniki według typu (w kolejności pierwszego
wystąpienia, aby pozycje ustawione przez administratora decydowały o kolejności sekcji), wyświetla
jeden nagłówek dla każdego typu i tworzy linki do pobrania z `download={filename}`, aby pobrane pliki
miały czytelne nazwy.

## Przechowywanie

`attachment_types` (id, code unique, name jsonb, position) +
`product_attachments` (id, product_id FK CASCADE, asset_id FK RESTRICT,
attachment_type_id FK RESTRICT, name, description, position).

Podstawa platformy nie ma publicznego `AssetsService` — katalog importuje encję `Asset` bezpośrednio
z innego modułu. Przesyłanie plików w panelu administracyjnym to zmiana planowana na poziomie podstawy
platformy; do tego czasu administratorzy przy tworzeniu załącznika wklejają identyfikator
istniejącego pliku.

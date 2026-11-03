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
| `POST /api/v1/admin/catalog/products/:id/attachments` | administrator | Dołączenie istniejącego pliku z typem oraz globalną nazwą i opisem |
| `PATCH /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | administrator | Zmiana typu lub pozycji |
| `PUT /api/v1/admin/catalog/products/:id/scoped-values` | administrator | Nazwa, opis i ukrycie w zakresie globalnym, w kanale albo w kanale i języku (zob. niżej) |
| `DELETE /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | administrator | Usunięcie (plik pozostaje) |

## W zakresie: globalnym, kanału, kanału × języka

Załącznik to ten sam plik w każdym kanale sprzedaży. W poszczególnych zakresach różnić się mogą
jego nazwa, opis i to, czy w ogóle jest pokazywany. Wszystkie trzy są polami zakresu, zapisywanymi
razem z resztą zakresu przez `PUT …/products/:id/scoped-values`:

```json
{
  "scope": { "channelId": "<retail-uuid>", "languageCode": "pl-PL" },
  "version": "7",
  "changes": {
    "attachments": { "<attachmentId>": { "name": "Karta techniczna", "description": null, "hidden": false } }
  }
}
```

- **Nazwa** — wymagana: najwyżej 160 znaków, nigdy pusta, w każdym zakresie. Pusta nazwa w
  zakresie globalnym jest odrzucana.
- **Opis** — najwyżej 4000 znaków; `null` zapisuje celowo pusty opis, który pozostaje tam pusty,
  nawet jeśli zakres nadrzędny ma opis.
- **Ukrycie** — `true` albo `false`, w zakresie globalnym, w kanale albo w kanale i języku. Ukryty
  załącznik nie jest w tym zakresie ani wymieniany na stronie produktu, ani z niej linkowany.

`{ "inherit": true }` usuwa własną wartość zakresu, a pole pominięte w żądaniu pozostaje bez zmian.
Zakres bez własnej wartości dziedziczy ją — kanał × język → kanał → globalny. Zapis w kanale, do
którego produkt nie należy, albo w języku, którego kanał nie oferuje, kończy się błędem
`422 SCOPE_INVALID`; usunięcie nadpisania jest zawsze dozwolone, także po usunięciu produktu z
kanału.

Ukrycie dotyczy tylko prezentacji, a nie kontroli dostępu. Ukryty załącznik nie jest pokazywany w
danym zakresie, ale jego plik zachowuje stały adres URL i każdy, kto ten adres zna, nadal może go
pobrać. Ukrycie nie zapewnia poufności dokumentu: pliku, który nie może być publiczny, nie należy
dołączać do produktu.

Utworzenie lub zmiana załącznika trafia do dziennika zdarzeń raz, jako `product_attachment.create`
albo `product_attachment.update`, ze stanem załącznika przed zmianą i po niej. Zapis zakresu trafia
do dziennika jako `product.scoped_values.save`. Oba ogłaszają zdarzenie `product.updated.v1`.
Żądanie, które niczego nie zmienia, niczego nie zapisuje i niczego nie ogłasza. Usunięcie
załącznika usuwa jego nadpisania we wszystkich zakresach.

Bez nadpisań każdy kanał i język pokazuje wszystkie załączniki pod ich globalnymi nazwami i z
globalnymi opisami.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Plik załącznika musi być rodzaju `pdf`, `certificate` lub `other` (zdjęcia i filmy tylko w galerii) |
| `ATTACHMENT_TYPE_IN_USE` | 409 | Usunięcie zablokowane, bo typ jest używany |
| `ATTACHMENT_TYPE_CODE_TAKEN` | 409 | Kolizja `code` przy tworzeniu |
| `ATTACHMENT_TYPE_NOT_FOUND` | 404 | Brak `:id` |
| `ATTACHMENT_NOT_FOUND` | 404 | Brak `:attachmentId` |
| `SCOPE_INVALID` | 422 | Wartość załącznika w zakresie kanału, do którego produkt nie należy, albo języka, którego kanał nie oferuje |

## Storefront

`productDetail.attachments[]` zawiera pełne metadane typu i pliku (filename, sizeBytes, mimeType,
url) w postaci, w jakiej pokazują je kanał sprzedaży i język żądania: bez załączników ukrytych w
tym miejscu, z nazwą i opisem obowiązującymi w tym miejscu. Komponent `<AttachmentsList>` grupuje załączniki według typu (w kolejności pierwszego
wystąpienia, aby pozycje ustawione przez administratora decydowały o kolejności sekcji), wyświetla
jeden nagłówek dla każdego typu i tworzy linki do pobrania z `download={filename}`, aby pobrane pliki
miały czytelne nazwy.

## Przechowywanie

`attachment_types` (id, code unique, name jsonb, position) +
`product_attachments` (id, product_id FK CASCADE, asset_id FK RESTRICT,
attachment_type_id FK RESTRICT, globalne nazwa, opis i ukrycie, position).
`product_attachment_scope_overrides` przechowuje nazwę, opis lub ukrycie w kanale albo w kanale i
języku; wskazuje załącznik razem z jego produktem, więc nadpisanie nie może wskazać załącznika
innego produktu, a wiersz jest usuwany razem z załącznikiem, produktem i kanałem.

Podstawa platformy nie ma publicznego `AssetsService` — katalog importuje encję `Asset` bezpośrednio
z innego modułu. Przesyłanie plików w panelu administracyjnym to zmiana planowana na poziomie podstawy
platformy; do tego czasu administratorzy przy tworzeniu załącznika wklejają identyfikator
istniejącego pliku.

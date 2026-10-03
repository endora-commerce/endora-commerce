---
title: Galeria produktu
---

# Galeria produktu

Każdy produkt może mieć galerię zdjęć i filmów z trzema oznaczeniami, które określają, który obraz
storefront pokazuje w którym miejscu:

- **Base Image** — główny obraz na stronie produktu. Dokładnie jeden na produkt.
- **Small Image** — obraz wyróżniony na pasku miniatur. Dokładnie jeden na produkt.
- **Thumbnail** — obraz na karcie produktu w listach. Dokładnie jeden na produkt.

Każdy element galerii może mieć **od jednego do trzech** z tych oznaczeń (ten sam plik może być np.
jednocześnie Base Image i Thumbnail). Regułę „dokładnie jeden element z danym oznaczeniem w
produkcie” wymusza ograniczenie bazy danych `UNIQUE (product_id, label)`, więc kolizja kończy się
typowanym błędem konfliktu, a nie cichym uszkodzeniem danych.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/products/:id/gallery` | administrator | Galeria produktu |
| `POST /api/v1/admin/catalog/products/:id/gallery` | administrator | Dodanie istniejącego zdjęcia lub filmu z opcjonalnymi oznaczeniami |
| `POST .../gallery?replace=true` | administrator | Atomowa zamiana: zdejmuje kolidujące oznaczenia z innych elementów tego produktu, a potem je przypisuje |
| `PATCH /api/v1/admin/catalog/products/:id/gallery/:itemId` | administrator | Zmiana oznaczeń (ten sam przełącznik `?replace=true`) |
| `DELETE /api/v1/admin/catalog/products/:id/gallery/:itemId` | administrator | Usunięcie z galerii (wiersz pliku pozostaje) |
| `PUT /api/v1/admin/catalog/products/:id/gallery/order` | administrator | Zmiana kolejności według listy identyfikatorów |

## Atomowa zamiana oznaczeń

Bez parametru `?replace=true` przypisanie oznaczenia, które ma już inny element, zwraca
`409 GALLERY_LABEL_ALREADY_TAKEN`. Z tym parametrem usługa najpierw usuwa kolidujące przypisania, a
potem wstawia nowe — wszystko w jednej transakcji, więc administratorzy pracujący równocześnie nigdy
nie zobaczą stanu zmienionego do połowy.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `GALLERY_LABEL_ALREADY_TAKEN` | 409 | Kolizja oznaczeń bez `?replace=true` |
| `GALLERY_LABEL_LIMIT_EXCEEDED` | 400 | Więcej niż 3 oznaczenia jednego elementu |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Rodzaj pliku ∉ `{image, video}` |
| `GALLERY_ITEM_NOT_FOUND` | 404 | Brak `:itemId` |
| `PRODUCT_NOT_FOUND` | 404 | Brak `:id` |

## Storefront

`productDetail.gallery[]` zawiera `{id, position, labels[], asset{id, kind, url}}`. Komponent
`<GallerySwitcher>` wyświetla Base Image jako główny `<img>` (albo pierwszy element, gdy Base Image
nie jest ustawiony) oraz pasek miniatur, w którym Small Image ma atrybut `data-small-image="true"`,
aby motywy mogły go wyróżnić.

## Obraz na karcie produktu w listach

`ProductSummary.primaryAssetUrl` (używane przez kartę produktu w listach) jest wyznaczane po stronie
serwera w kolejności: Thumbnail → Base Image → pierwszy element galerii → dawny wiersz
`product_assets` → null.

## Obraz Open Graph

`productDetail.seo.openGraph.imageUrl` korzysta przede wszystkim z Base Image z galerii, a dopiero
potem z miniatury z listy, aby udostępnienia w serwisach społecznościowych pokazywały obraz wybrany
przez marketing.

## Przechowywanie

`gallery_items` (id, product_id FK CASCADE, asset_id FK RESTRICT, position, znaczniki czasu) i
`gallery_item_labels` (złożony klucz główny (gallery_item_id, label), `UNIQUE (product_id, label)`,
CHECK label IN ('base_image', 'small_image', 'thumbnail')).

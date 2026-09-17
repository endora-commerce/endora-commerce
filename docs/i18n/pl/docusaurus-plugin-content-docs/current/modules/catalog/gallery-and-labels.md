---
title: Galeria produktu
---

# Galeria produktu

Każdy produkt może mieć kuratorowaną galerię assetów obrazu i wideo z trzema
etykietami, które pinują łańcuch rozwiązywania storefront:

- **Base Image** — główny hero na PDP. Dokładnie jeden na produkt.
- **Small Image** — wyróżniony w pasku miniaturek. Dokładnie jeden na produkt.
- **Thumbnail** — obraz karty listingu. Dokładnie jeden na produkt.

Każdy element galerii może mieć **od jednej do trzech** z tych etykiet (ten sam
asset może być np. jednocześnie Base Image i Thumbnail). Invariant „dokładnie
jeden na produkt per etykieta” egzekwuje ograniczenie bazy
`UNIQUE (product_id, label)`, więc kolizje wychodzą jako typowany błąd konfliktu
zamiast cichej korupcji danych.

## Publiczne API

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/products/:id/gallery` | admin | Lista galerii produktu |
| `POST /api/v1/admin/catalog/products/:id/gallery` | admin | Dołączenie istniejącego assetu image/video z opcjonalnymi etykietami |
| `POST .../gallery?replace=true` | admin | Atomowa podmiana: usuń konfliktowe etykiety z innych elementów tego produktu, potem przypisz |
| `PATCH /api/v1/admin/catalog/products/:id/gallery/:itemId` | admin | Aktualizacja etykiet (ten sam przełącznik `?replace=true`) |
| `DELETE /api/v1/admin/catalog/products/:id/gallery/:itemId` | admin | Usunięcie z galerii (wiersz Asset przeżywa) |
| `PUT /api/v1/admin/catalog/products/:id/gallery/order` | admin | Zmiana kolejności według listy id |

## Atomowa podmiana etykiet

Bez query `?replace=true` przypisanie etykiety, która już istnieje na innym
elemencie, zwraca `409 GALLERY_LABEL_ALREADY_TAKEN`. Z nim serwis najpierw
usuwa konfliktowe przypisania, potem wstawia nowe — wszystko w jednej
transakcji, więc współbieżni admini nigdy nie widzą stanu w połowie zastosowanym.

## Błędy

| Code | Status | Kiedy |
| --- | --- | --- |
| `GALLERY_LABEL_ALREADY_TAKEN` | 409 | Konflikt etykiety bez `?replace=true` |
| `GALLERY_LABEL_LIMIT_EXCEEDED` | 400 | Więcej niż 3 etykiety na jednym elemencie |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Rodzaj assetu ∉ `{image, video}` |
| `GALLERY_ITEM_NOT_FOUND` | 404 | Brak `:itemId` |
| `PRODUCT_NOT_FOUND` | 404 | Brak `:id` |

## Integracja ze storefrontem

`productDetail.gallery[]` niesie `{id, position, labels[], asset{id, kind, url}}`.
Komponent `<GallerySwitcher>` renderuje Base Image jako główny `<img>` (lub pierwszy
element, gdy Base Image nie jest ustawiony) i emituje pasek miniaturek z Small
Image oznaczonym przez `data-small-image="true"`, żeby motywy mogły go
wyróżnić.

## Rozwiązywanie miniatury karty listingu

`ProductSummary.primaryAssetUrl` (używane przez kartę listingu) jest rozwiązywane
po stronie serwera łańcuchem: Thumbnail → Base Image → pierwszy element galerii
→ legacy wiersz `product_assets` → null.

## Rozwiązywanie obrazu OG

`productDetail.seo.openGraph.imageUrl` preferuje Base Image z galerii nad miniaturą
listingu, żeby udostępnienia społecznościowe dostały hero marketera.

## Magazynowanie

`gallery_items` (id, product_id FK CASCADE, asset_id FK RESTRICT,
position, timestamps) + `gallery_item_labels` (composite PK na
(gallery_item_id, label), `UNIQUE (product_id, label)`, CHECK label IN
('base_image', 'small_image', 'thumbnail')).

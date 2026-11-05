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
| `PATCH /api/v1/admin/catalog/products/:id/gallery/:itemId` | administrator | Przesunięcie elementu (`position`) |
| `PUT /api/v1/admin/catalog/products/:id/scoped-values` | administrator | Tekst alternatywny, ukrycie i elementy pełniące role w zakresie globalnym, w kanale albo w kanale i języku (zob. niżej) |
| `DELETE /api/v1/admin/catalog/products/:id/gallery/:itemId` | administrator | Usunięcie z galerii (wiersz pliku pozostaje) |
| `PUT /api/v1/admin/catalog/products/:id/gallery/order` | administrator | Zmiana kolejności według listy identyfikatorów |

## Atomowa zamiana oznaczeń

Bez parametru `?replace=true` przypisanie przy dodawaniu oznaczenia, które ma już inny element, zwraca
`409 GALLERY_LABEL_ALREADY_TAKEN`. Z tym parametrem usługa najpierw usuwa kolidujące przypisania, a
potem wstawia nowe — wszystko w jednej transakcji, więc administratorzy pracujący równocześnie nigdy
nie zobaczą stanu zmienionego do połowy.

## W zakresie: globalnym, kanału, kanału × języka

Zestaw zdjęć jest taki sam w każdym kanale sprzedaży: kanał nie może dodać własnego
zdjęcia ani zmienić kolejności galerii. Zakres może zmienić tekst alternatywny obrazu,
to, czy obraz jest pokazywany, i to, który element pełni daną rolę. Wszystkie trzy są
polami zakresu, zapisywanymi razem z resztą zakresu przez
`PUT …/products/:id/scoped-values`:

```json
{
  "scope": { "channelId": "<retail-uuid>", "languageCode": "pl-PL" },
  "version": "7",
  "changes": {
    "gallery": {
      "items": { "<itemId>": { "altText": "Wiertarka z boku", "hidden": { "inherit": true } } },
      "roles": { "baseImage": "<itemId>", "smallImage": null }
    }
  }
}
```

- **Tekst alternatywny** — w zakresie globalnym, w kanale albo w kanale i języku. Gdy w
  całym łańcuchu produkt nie ma własnego tekstu alternatywnego, obowiązuje tekst
  alternatywny samego pliku w języku żądania. Celowo pusty tekst alternatywny (`null`)
  jest wyświetlany jako `alt=""`: obraz jest tam dekoracyjny, a tekst pliku nie jest
  używany.
- **Ukrycie** — w zakresie globalnym, w kanale albo w kanale i języku; `true` albo `false`,
  nigdy wartość pusta. Ukryty element nie jest pokazywany w tym zakresie: ani w galerii na
  stronie produktu, ani jako obraz na karcie produktu w listach, ani jako obraz Open Graph,
  ani w pliku produktowym, ani w porównaniu.
- **Elementy pełniące role** (`baseImage`, `smallImage`, `thumbnail`) — w zakresie
  globalnym, w kanale albo w kanale i języku. `null` zapisuje puste nadpisanie: żaden
  element nie pełni tam tej roli. `{ "inherit": true }` przywraca rolę z zakresu
  nadrzędnego. Rola, której element jest ukryty w danym zakresie, nie ma tam elementu, więc
  karta produktu bierze następny obraz w swojej kolejności. Usunięcie elementu pełniącego
  rolę sprawia, że nadpisanie znowu dziedziczy.

Zakres, który nie zapisuje pola, dziedziczy je z zakresu nadrzędnego — kanał × język →
kanał → globalny. Zapis w kanale, do którego produkt nie należy, albo w języku, którego
kanał nie oferuje, kończy się błędem `422 SCOPE_INVALID`. Usunięcie nadpisania jest zawsze
dozwolone, także po usunięciu produktu z kanału.

Ukrycie dotyczy tylko prezentacji, a nie kontroli dostępu. Ukryty element nie jest
pokazywany w danym zakresie, ale jego plik zachowuje stały adres URL i każdy, kto ten adres
zna, nadal może go pobrać. Ukrycie nie zapewnia poufności obrazu: pliku, który nie może być
publiczny, nie należy umieszczać w galerii produktu.

Zapis to jedno polecenie zapisywane w dzienniku zdarzeń, `product.scoped_values.save`, i
ogłasza zdarzenie `product.updated.v1`. `PUT …/gallery/order` zapisuje
`orderedGalleryItemIds` przed zmianą i po niej i działa w jednej transakcji. Usunięcie
elementu trafia do dziennika raz, jako `gallery_item.delete`, i usuwa jego nadpisania we
wszystkich zakresach.

Bez nadpisań każdy kanał i język pokazuje galerię globalną.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `GALLERY_LABEL_ALREADY_TAKEN` | 409 | Kolizja oznaczeń bez `?replace=true` |
| `GALLERY_LABEL_LIMIT_EXCEEDED` | 400 | Więcej niż 3 oznaczenia jednego elementu |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Rodzaj pliku ∉ `{image, video}` |
| `GALLERY_ITEM_NOT_FOUND` | 404 | Brak `:itemId` |
| `SCOPE_INVALID` | 422 | Wartość galerii w zakresie kanału, do którego produkt nie należy, albo języka, którego kanał nie oferuje |
| `PRODUCT_NOT_FOUND` | 404 | Brak `:id` |

## Storefront

`productDetail.gallery[]` zawiera `{id, position, labels[], asset{id, kind, url}, altText}` w
postaci, w jakiej pokazują go kanał sprzedaży i język żądania: bez elementów ukrytych, z rolami
obowiązującymi w tym miejscu w `labels` i z obowiązującym tam tekstem alternatywnym w `altText`. Komponent
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

`gallery_items` (id, product_id FK CASCADE, asset_id FK RESTRICT, position, globalne `alt_text` i
`hidden`, znaczniki czasu) i `gallery_item_labels` (złożony klucz główny (gallery_item_id, label),
`UNIQUE (product_id, label)`, CHECK label IN ('base_image', 'small_image', 'thumbnail')) — elementy
pełniące role w zakresie globalnym. `gallery_item_scope_overrides` przechowuje tekst alternatywny i
ukrycie elementu w kanale albo w kanale i języku, a `gallery_role_scope_overrides` — element pełniący
rolę w tych zakresach (`gallery_item_id` równe `null` oznacza, że żaden element jej nie pełni). Obie
tabele wskazują element razem z jego produktem, więc nadpisanie nie może wskazać obrazu innego
produktu, a ich wiersze są usuwane razem z produktem, elementem i kanałem.

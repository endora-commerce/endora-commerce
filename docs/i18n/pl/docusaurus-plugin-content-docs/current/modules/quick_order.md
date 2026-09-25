---
title: quick_order
description: Import CSV + type-ahead dla kupujących zamawiających po SKU
---

# `quick_order`

**Zestaw narzędzi szybkiego zamawiania** platformy.
Łączy kilka udogodnień, które pozwalają kupującym B2B składać powtarzalne i
wolumenowe zamówienia w najmniejszej liczbie kroków, ponownie używając istniejących
możliwości Cart, Quote Request, Order/Checkout, Organization, metod Payment/Shipping,
Catalog i Settings zamiast wprowadzać równoległy silnik zamówień.

## Możliwości

### 1. Import CSV / Excel → Cart lub Quote Request

`POST /api/v1/quick-order/import` akceptuje wklejony CSV (`csv`) **lub**
przesłany plik CSV / `.xlsx` (`file: { filename, contentBase64 }`). Oba są
normalizowane do tego samego modelu wiersza i walidowane względem katalogu:

- Wymagane kolumny `sku` + `quantity` (wiersz nagłówka, niezależny od kolejności,
  case-insensitive). Każda inna kolumna traktowana jest jako **wartość atrybutu wariantu**
  i rozwiązywana względem atrybutów osi wariantu produktu nadrzędnego —
  wiersz rozwiązuje się tylko gdy dokładnie jeden wariant do kupienia pasuje.
- Odpowiedź dzieli wiersze na `recognized` + `rejected` (każdy z powodem per wiersz:
  `sku_missing`, `quantity_invalid`, `product_not_found`,
  `product_archived`, `malformed_row`, `variant_not_resolved`,
  `variant_ambiguous`, `row_limit_exceeded`) plus `summary`.
- Duplikaty SKU są scalane (ilości sumowane); wiersze poza
  `quick_order.import_max_rows` są odrzucane.

`POST /api/v1/quick-order/build` zamienia potwierdzone rozpoznane wiersze w
**Cart** (`CartService`) lub **Quote Request** (`RfqService`), wycenione według
bieżącego cennika kupującego / organization. Admin twins
(`/api/v1/admin/quick-order/import` + `/build`, chronione przez `orders:write`)
budują w imieniu wybranego klienta przez `onBehalfOf`.

Parsowanie `.xlsx` używa **`exceljs`** (tylko backend, izolowane w
`excel-importer.ts`); czytany jest tylko pierwszy arkusz.

### 2. Szybkie wyszukiwanie

`GET /api/v1/quick-order/search?q=` dopasowuje po SKU, nazwie produktu oraz
wartościach atrybutów oznaczonych **`quick_searchable`** (niezależny boolean na
`product_attributes`, przełączany w managerze Attributes w adminie). Wartości
atrybutów bez flagi nigdy nie pasują. Session-gated; channel-scoped.

### 3. Domyślne preferencje zamawiania

`quick_order_default_preferences` przechowuje cztery domyślne wartości — metodę płatności,
metodę dostawy, adres rozliczeniowy, adres wysyłki — per target
(`scope` = `organization` | `customer`). Rozwiązywanie to most-specific-wins
(klient nadpisuje organization, per pole) z ponowną weryfikacją kwalifikacji w momencie użycia
(aktywny / dozwolony dla org / adres istnieje → w przeciwnym razie null).

- Storefront: klient zarządza własnymi domyślnymi (`/preferences`); checkout
  pre-wybiera rozwiązane domyślne.
- Admin: `/api/v1/admin/quick-order/preferences` — platform admin zarządza dowolnym
  zakresem; salesperson tylko przypisanymi organizations i klientami tych org.
  Każda zmiana jest audytowana.

### 4. Reorder

„Zamów ponownie” na przeszłym zamówieniu produkuje nowy Cart
(`POST /orders/:id/reorder`) lub nowy Quote Request
(`POST /orders/:id/clone-to-quote`) po bieżących cenach, raportując niedostępne
linie i respektując ustawienie `orders.reorder_enabled`.

### 5. One-click buy

Gdy `quick_order.one_click_buy_enabled` jest włączone dla sales channel kupującego
**oraz** kupujący ma wszystkie cztery kwalifikujące się domyślne, strona produktu
pokazuje przycisk „Kup jednym kliknięciem”. Pomija Cart i Checkout: zamówienie
składane jest z domyślnych (`clear cart → add product → OrderService.placeOrder`),
a kupujący kierowany jest przez `nextAction` płatności (redirect bramki lub strona
zamówienia / sukcesu, gdy krok płatności nie jest wymagany). Te same walidacje co
normalne zamówienie (org aktywna, wartość minimalna, limit kredytowy, stock).

## Ustawienia

| Code | Type | Default | Scope |
|------|------|---------|-------|
| `quick_order.one_click_buy_enabled` | boolean | `false` | per sales channel |
| `quick_order.import_max_rows` | number | `2000` | global |

## Dane

- Nowa tabela `quick_order_default_preferences` (migracja 057).
- Nowa kolumna `product_attributes.quick_searchable` (migracja 058, catalog).

## Zależności

Opiera się na `orders` (rdzeń zamawiania), `carts`, `quote_requests`,
`organizations`, `payment_methods`, `delivery_methods`, `catalog`, `addresses`
oraz `settings`. Moduł `orders` **nie** zależy od `quick_order`; przepływ one-click
otrzymuje `OrderService` przez lazy getter podłączony w composition.

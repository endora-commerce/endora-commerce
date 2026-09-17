---
title: promotions
description: Rabaty procentowe / kwotowe / darmowa dostawa na poziomie koszyka z filtrami kwalifikacji
---

# `promotions`

Moduł promotions to konfigurowalny silnik rabatów oparty na regułach
(feature 045, na oryginalnym slajsie cart-discount). **Promotion**
łączy kwalifikującą **Rule** z **Action**; silnik ocenia każdą aktywną promocję
wobec koszyka, stosuje pasujące w kolejności priorytetu i pokazuje wynik w koszyku
oraz na złożonym zamówieniu.

## Pojęcia

- **Rule** — typowane AST (`all` | `condition` | `group`) nad wbudowanymi polami
  koszyka (suma koszyka, metoda płatności, metoda dostawy, kraj dostawy,
  kod pocztowy dostawy, organization, customer group, kategoria produktu) oraz
  atrybutami produktów kwalifikujących do promo. Warunki niosą operator
  (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`between`/`in`/`notIn`/`contains`/
  `startsWith`) i wartości; grupy łączą dzieci przez `AND`/`OR` (max głębokość
  5). Regułę można napisać inline lub odwołać się do biblioteki **named-rule**
  (`promotion_rules`).
- **Action** — jeden skonfigurowany efekt z rejestru. Wbudowane:
  `free_delivery`, `percentage_off_cart`, `amount_off_cart`,
  `buy_x_get_y_free` (cel najtańszy/najdroższy), `spend_x_percent_off`,
  `spend_x_amount_off`, `every_nth_product_percent_off`, `buy_x_units_y_free`,
  `buy_x_units_percent_off`, `buy_x_units_amount_off`. Inne moduły rejestrują
  dodatkowe typy akcji przez `PromotionActionRegistry.register(...)`.
- **Priority & stacking** — kwalifikujące promocje stosują się w kolejności
  `priority` DESC (deterministyczny tie-break: `createdAt`, potem `id`). Promocja
  z flagą `stopFurther` zatrzymuje promocje niższego priorytetu. Rabaty nigdy nie
  spychają linii, subtotalu, dostawy ani sumy poniżej zera.
- **Coupons** — promocja może mieć kupony (`promotion_coupons`): pojedynczy
  określony kod lub wygenerowana partia (`coupon_batches`). Promocja z kuponem
  stosuje się tylko przy podanym pasującym kodzie. Legacy kolumna `promotions.code`
  nadal jest honorowana.
- **Usage limits** — opcjonalne limity globalne / per-organization / per-customer.
  Partie kuponów wybierają zakres `per_coupon` vs `shared_batch` dla globalnej
  puli. Użycie liczy się tylko przy udanym złożeniu zamówienia.
- **Statistics** — `promotion_usages` rejestruje każde sfinalizowane wykorzystanie
  z denormalizowanymi wymiarami, agregowanymi w sumy + rozbicia po kliencie,
  customer group, organization i sales channel.

## Przepływ stosowania

1. `PromotionService.applyToCart(snapshot)` ładuje aktywne promocje, rozwiązuje
   podany kod kuponu, miękko wyklucza wyczerpane promocje, ocenia każdą regułę,
   uruchamia akcję przez rejestr na bieżących sumach i zwraca skorygowane sumy
   plus rozbicie per promocja.
2. Ścieżka odczytu koszyka woła to przy każdym odczycie, więc koszyk pokazuje
   rzeczywistą kwotę rabatu i `appliedPromotions[]`.
3. Przy składaniu zamówienia serwis zamówień przelicza stosowanie, stempluje
   `order_applied_promotions` + `orders.discount_total` i **finalizuje
   użycie** w transakcji składania.

## Finalizacja użycia (odporna na wyścigi)

`finalizeUsage` działa w transakcji składania zamówienia. Każdy licznik w
zakresie jest podbijany przez `UPDATE promotion_usage_counters SET count =
count + 1 WHERE (scope_type, scope_key) = … AND count < :limit`. Zero
zmienionych wierszy oznacza osiągnięty limit, więc rzucany jest
`409 promotion_unavailable` i całe składanie się wycofuje. Dwa koszyki w wyścigu
o ostatnie użycie nigdy nie mogą oba wygrać.

## Publiczne API (admin, gated przez `promotions:read|write|delete`)

| Verb + Path | Cel |
| --- | --- |
| `GET/POST/PUT/DELETE /api/v1/admin/promotions[/:id]` | CRUD promocji |
| `GET /api/v1/admin/promotions/action-types` | Katalog akcji dla edytora |
| `GET /api/v1/admin/promotions/rule-targets/attributes` | Atrybuty kwalifikujące do promo |
| `POST /api/v1/admin/promotions/preview` | Stosuj wobec `CartSnapshot` |
| `GET/POST /api/v1/admin/promotions/:id/coupons` | Zarządzanie pojedynczym kuponem |
| `POST /api/v1/admin/promotions/:id/coupon-batches` | Generator masowy |
| `GET .../coupon-batches/:batchId/export` | Eksport CSV wygenerowanych kodów |
| `GET /api/v1/admin/promotions/:id/stats` | Statystyki użycia |
| `GET/POST/PUT/DELETE /api/v1/admin/promotion-rules[/:id]` | Biblioteka named-rule |

Realizacja kuponu na storefront idzie przez istniejące endpointy kuponu koszyka
(`POST /api/v1/cart/coupon`), które rozwiązują kod przez tabelę kuponów lub
legacy kolumnę.

## Uprawnienia

- `promotions:read` — podgląd promocji, reguł, kuponów, statystyk.
- `promotions:write` — tworzenie + edycja promocji i reguł, zarządzanie kuponami.
- `promotions:delete` — usuwanie promocji i reguł.

## Uwaga wydajnościowa

Wycena koszyka ładuje aktywne promocje jednym indeksowanym zapytaniem plus
lookup kuponów/liczników. W docelowej skali platformy to wystarcza; Redis cache
kandydatów per channel (invalidowany przez pub/sub cyklu życia modułu) to
udokumentowana kolejna optymalizacja, gdy profilowanie pokaże gorące obciążenie
per request — celowo odroczone pod YAGNI do tego momentu.

---
title: promotions
description: Rabaty na poziomie koszyka — procentowe, kwotowe i darmowa dostawa — z warunkami, które muszą być spełnione
---

# `promotions`

Moduł promocji to konfigurowalny silnik rabatów oparty na regułach, zbudowany na pierwotnym
mechanizmie rabatów w koszyku. **Promocja** łączy **regułę**, która określa, kiedy promocja
obowiązuje, z **akcją**; silnik sprawdza każdą aktywną promocję względem koszyka, stosuje pasujące w
kolejności priorytetu i pokazuje wynik w koszyku oraz w złożonym zamówieniu.

## Pojęcia

- **Reguła** — typowane drzewo (`all` | `condition` | `group`) oparte na wbudowanych polach koszyka
  (wartość koszyka, metoda płatności, metoda dostawy, kraj dostawy, kod pocztowy dostawy,
  organizacja, grupa klientów, kategoria produktu) oraz atrybutach produktów, które mogą być
  używane w promocjach. Warunki mają operator
  (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`between`/`in`/`notIn`/`contains`/`startsWith`) i wartości;
  grupy łączą elementy podrzędne przez `AND`/`OR` (najwyżej 5 poziomów). Regułę można zapisać
  bezpośrednio w promocji albo odwołać się do biblioteki **nazwanych reguł** (`promotion_rules`).
- **Akcja** — jeden skonfigurowany skutek z rejestru. Wbudowane: `free_delivery`,
  `percentage_off_cart`, `amount_off_cart`, `buy_x_get_y_free` (gratis najtańszy albo najdroższy
  produkt), `spend_x_percent_off`, `spend_x_amount_off`, `every_nth_product_percent_off`,
  `buy_x_units_y_free`, `buy_x_units_percent_off`, `buy_x_units_amount_off`. Inne moduły rejestrują
  dodatkowe typy akcji przez `PromotionActionRegistry.register(...)`.
- **Priorytet i łączenie** — pasujące promocje są stosowane w kolejności malejącego `priority`
  (remisy rozstrzyga deterministycznie `createdAt`, a potem `id`). Promocja z flagą `stopFurther`
  wstrzymuje promocje o niższym priorytecie. Rabaty nigdy nie obniżają poniżej zera wartości
  pozycji, sumy częściowej, dostawy ani całego zamówienia.
- **Kupony** — promocja może mieć kupony (`promotion_coupons`): jeden konkretny kod albo
  wygenerowaną partię (`coupon_batches`). Promocja z kuponem obowiązuje tylko po podaniu pasującego
  kodu. Dawna kolumna `promotions.code` nadal jest uwzględniana.
- **Limity użycia** — opcjonalne limity globalne, dla organizacji i dla klienta. Partie kuponów mają
  zakres `per_coupon` albo `shared_batch` dla puli globalnej. Użycie liczy się dopiero po
  skutecznym złożeniu zamówienia.
- **Statystyki** — `promotion_usages` zapisuje każde wykorzystanie promocji wraz z danymi do analizy
  i sumuje je w podziale na klientów, grupy klientów, organizacje i kanały sprzedaży.

## Stosowanie promocji

1. `PromotionService.applyToCart(snapshot)` wczytuje aktywne promocje, odnajduje podany kod kuponu,
   pomija promocje z wyczerpanym limitem, sprawdza każdą regułę, wykonuje akcję przez rejestr na
   bieżących sumach i zwraca skorygowane sumy wraz z rozbiciem na promocje.
2. Odczyt koszyka wywołuje to przy każdym odczycie, więc koszyk pokazuje rzeczywistą kwotę rabatu i
   `appliedPromotions[]`.
3. Przy składaniu zamówienia usługa zamówień ponownie oblicza rabaty, zapisuje
   `order_applied_promotions` i `orders.discount_total` oraz **zapisuje wykorzystanie** w transakcji
   składania zamówienia.

## Zapisywanie wykorzystania (odporne na wyścigi)

`finalizeUsage` działa w transakcji składania zamówienia. Każdy licznik w danym zakresie jest
zwiększany przez `UPDATE promotion_usage_counters SET count = count + 1 WHERE (scope_type, scope_key) = … AND count < :limit`.
Brak zmienionych wierszy oznacza, że limit został osiągnięty, więc rzucany jest
`409 promotion_unavailable` i całe składanie zamówienia jest wycofywane. Dwa koszyki rywalizujące o
ostatnie użycie nigdy nie wygrają obydwa.

## API publiczne (panel administracyjny, chronione przez `promotions:read|write|delete`)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET/POST/PUT/DELETE /api/v1/admin/promotions[/:id]` | Zarządzanie promocjami |
| `GET /api/v1/admin/promotions/action-types` | Katalog akcji dla edytora |
| `GET /api/v1/admin/promotions/rule-targets/attributes` | Atrybuty, których można używać w promocjach |
| `POST /api/v1/admin/promotions/preview` | Podgląd zastosowania dla `CartSnapshot` |
| `GET/POST /api/v1/admin/promotions/:id/coupons` | Zarządzanie pojedynczymi kuponami |
| `POST /api/v1/admin/promotions/:id/coupon-batches` | Generowanie kuponów hurtowo |
| `GET .../coupon-batches/:batchId/export` | Eksport wygenerowanych kodów do CSV |
| `GET /api/v1/admin/promotions/:id/stats` | Statystyki wykorzystania |
| `GET/POST/PUT/DELETE /api/v1/admin/promotion-rules[/:id]` | Biblioteka nazwanych reguł |

Kupony w storefroncie realizuje się przez istniejące endpointy kuponu w koszyku
(`POST /api/v1/cart/coupon`), które odnajdują kod w tabeli kuponów albo w dawnej kolumnie.

## Uprawnienia

- `promotions:read` — podgląd promocji, reguł, kuponów i statystyk.
- `promotions:write` — tworzenie i edycja promocji i reguł, zarządzanie kuponami.
- `promotions:delete` — usuwanie promocji i reguł.

## Wydajność

Wyznaczanie cen w koszyku wczytuje aktywne promocje jednym indeksowanym zapytaniem oraz odczytem
kuponów i liczników. W docelowej skali platformy to wystarcza; pamięć podręczna kandydatów dla
kanału w Redis (unieważniana przez pub/sub cyklu życia modułów) to udokumentowana kolejna
optymalizacja, gdy profilowanie wykaże duże obciążenie na każde żądanie — zgodnie z YAGNI celowo
odłożona do tego czasu.

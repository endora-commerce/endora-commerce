---
title: Promocje
description: Rabaty na poziomie koszyka — procentowe, kwotowe i darmowa dostawa — z warunkami, które muszą być spełnione
---

# Promocje (`promotions`)

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

## Od czego liczony jest rabat

Rabat to kwota, której kupujący nie płaci, odejmowana od sumy brutto.

- **Akcje procentowe** — `percentage_off_cart`, `buy_x_units_percent_off`,
  `spend_x_percent_off`, `every_nth_product_percent_off` i dawny rodzaj
  `percentage_off` — liczą procent od kwoty **brutto**, którą kupujący płaci za
  towary: 10 % rabatu to 10 % tej kwoty brutto.
- **Akcje z gratisem** — `buy_x_get_y_free` i `buy_x_units_y_free` — odejmują
  kwotę brutto gratisowych sztuk, więc gratis jest darmowy razem z VAT.
  Najtańsza albo najdroższa sztuka to ta o najniższej albo najwyższej cenie
  brutto.
- **Kwoty stałe** — `amount_off_cart`, `buy_x_units_amount_off`,
  `spend_x_amount_off` i dawny rodzaj `amount_off` — odejmują skonfigurowaną
  kwotę, najwyżej do sumy **brutto**: kwota stała może sprawić, że towary są
  darmowe razem z VAT.
- **Progi** — kroki „wydaj X”, `minCartSubtotal`, sprawdzenie minimalnej
  wartości zamówienia przy kuponie i wartość koszyka w kreatorze reguł —
  porównują kwotę **brutto**, którą kupujący płaci za towary, przed rabatem.
  Kupon odrzucony poniżej minimalnej wartości podaje brakującą kwotę brutto.

Kwota brutto to VAT liczony dla każdej stawki od sumy netto pozycji, ta sama,
którą naliczają koszyk i zamówienie. Każda pozycja `CartSnapshot` niesie swoją
stawkę VAT jako `taxRate`, ułamek (`0.23`). Pozycja bez stawki nie ma VAT.
Koszyk, szczegóły koszyka w panelu, podgląd w kasie i składanie zamówienia
przekazują stawki, które naliczają, więc wszystkie cztery pokazują ten sam
rabat. Wywołanie `POST /api/v1/admin/promotions/preview` musi podać `taxRate` w
każdej pozycji, żeby otrzymać rabat, jaki naliczy zamówienie. Do zmiany z
issue #1350 akcje procentowe i z gratisem liczyły rabat od cen netto; do zmiany
z issue #1396 progi porównywały sumę netto, a kwoty stałe były do niej
ograniczone.

## Zapisywanie wykorzystania (odporne na wyścigi)

`finalizeUsage` działa w transakcji składania zamówienia. Każdy licznik w danym zakresie jest
zwiększany przez `UPDATE promotion_usage_counters SET count = count + 1 WHERE (scope_type, scope_key) = … AND count < :limit`.
Brak zmienionych wierszy oznacza, że limit został osiągnięty, więc rzucany jest
`409 PROMOTION_USAGE_LIMIT_REACHED` i całe składanie zamówienia jest wycofywane. Dwa koszyki
rywalizujące o ostatnie użycie nigdy nie wygrają obydwa. Kupujący czyta zdanie, które wymienia
zastosowany przez niego kupon (`details.code` `with_coupon`, `couponCode`), albo mówi o promocji bez
jej nazwy, gdy kuponu nie było — nigdy identyfikator promocji, który trafia tylko do
`details.promotionId`.

## API publiczne (panel administracyjny, chronione przez `promotions:read|write|delete`)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET/POST/PUT/DELETE /api/v1/admin/promotions[/:id]` | Zarządzanie promocjami |
| `GET /api/v1/admin/promotions?page=&pageSize=` | Jedna strona promocji według nazwy, z `meta: { page, pageSize, total }`; bez `pageSize` cała lista (issue #1664) |
| `GET /api/v1/admin/promotions/action-types` | Katalog akcji dla edytora |
| `GET /api/v1/admin/promotions/rule-targets/attributes` | Atrybuty, których można używać w promocjach |
| `GET /api/v1/admin/promotions/rule-targets/{categories,customer-groups,delivery-methods,organizations,payment-methods,sales-channels}` | Pozostałe listy wyboru edytora reguł |
| `POST /api/v1/admin/promotions/preview` | Podgląd zastosowania dla `CartSnapshot` |
| `GET/POST /api/v1/admin/promotions/:id/coupons` | Zarządzanie pojedynczymi kuponami |
| `POST /api/v1/admin/promotions/:id/coupons/bulk-active` | Aktywowanie lub dezaktywowanie wielu kuponów naraz |
| `POST /api/v1/admin/promotions/:id/coupon-batches` | Generowanie kuponów hurtowo |
| `GET .../coupon-batches/:batchId/export` | Eksport wygenerowanych kodów do CSV |
| `GET /api/v1/admin/promotions/:id/stats` | Statystyki wykorzystania |
| `GET /api/v1/admin/promotions/coupons/:couponId/stats` | Statystyki wykorzystania jednego kuponu |
| `GET/POST/PUT/DELETE /api/v1/admin/promotion-rules[/:id]` | Biblioteka nazwanych reguł |

## Odmowy

Każda odmowa ma własny kod i zdanie po angielsku i po polsku, które wymienia wartości z `details`.
Do zgłoszenia #628 były to odpowiedzi `VALIDATION_FAILED` z tokenem maszynowym na początku
komunikatu; status się nie zmienił.

| Kod | Status | Kiedy | `details` |
| --- | --- | --- | --- |
| `PROMOTION_USAGE_LIMIT_REACHED` | `409` | `POST /api/v1/orders` — limit użyć promocji wyczerpał się między koszykiem a złożeniem zamówienia | `promotionId`; z kuponem także `code: 'with_coupon'` i `couponCode` |
| `PROMOTION_COUPON_CODE_TAKEN` | `409` | `POST …/coupons` — inny kupon ma już ten kod | `couponCode` |
| `PROMOTION_COUPON_SPACE_EXHAUSTED` | `400` | `POST …/coupon-batches` — długość i format mieszczą mniej unikalnych kodów, niż zamówiono | `requested`, `generated` |
| `PROMOTION_RULE_NAME_TAKEN` | `409` | `POST`, `PUT /api/v1/admin/promotion-rules[/:id]` — inna reguła ma już tę nazwę | `name` |
| `PROMOTION_RULE_IN_USE` | `409` | `DELETE /api/v1/admin/promotion-rules/:id` — z reguły korzystają promocje | `ruleId`, `promotionCount` |
| `PROMOTION_ATTRIBUTE_NOT_ELIGIBLE` | `400` | `POST`, `PUT /api/v1/admin/promotions[/:id]` — kryterium wskazuje atrybut, którego nie można używać w regułach promocyjnych | `attributeKey` |

Partia większa niż limit generatora, nieznany typ akcji, reguła lub atrybut, operator niedozwolony
dla typu atrybutu i opcja, której atrybut nie ma, nadal dają `VALIDATION_FAILED`.

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

---
title: Szybkie zamówienia
description: Import CSV i podpowiedzi dla kupujących zamawiających według SKU
---

# Szybkie zamówienia (`quick_order`)

**Zestaw narzędzi do szybkiego zamawiania** w platformie. Łączy kilka udogodnień, dzięki którym
kupujący B2B składają powtarzalne i hurtowe zamówienia w jak najmniejszej liczbie kroków —
korzystając z istniejących możliwości koszyka, zapytań ofertowych, zamówień i checkoutu, organizacji,
metod płatności i dostawy, katalogu oraz ustawień, zamiast wprowadzać równoległy mechanizm
zamawiania.

## Możliwości

### 1. Import CSV / Excel → koszyk lub zapytanie ofertowe

`POST /api/v1/quick-order/import` przyjmuje wklejony CSV (`csv`) **albo** przesłany plik CSV /
`.xlsx` (`file: { filename, contentBase64 }`). Oba są sprowadzane do tego samego modelu wiersza i
sprawdzane względem katalogu:

- Wymagane kolumny to `sku` i `quantity` (wiersz nagłówka, dowolna kolejność, bez rozróżniania
  wielkości liter). Każda inna kolumna jest traktowana jako **wartość atrybutu wariantu** i
  dopasowywana do atrybutów osi wariantów produktu nadrzędnego — wiersz zostaje rozpoznany tylko
  wtedy, gdy pasuje dokładnie jeden wariant dostępny do zakupu.
- Odpowiedź dzieli wiersze na `recognized` i `rejected` (każdy odrzucony z powodem: `sku_missing`,
  `quantity_invalid`, `product_not_found`, `product_archived`, `malformed_row`,
  `variant_not_resolved`, `variant_ambiguous`, `row_limit_exceeded`, `below_minimum`) i zawiera
  `summary`. `product_archived` oznacza, że produkt jest zarchiwizowany (akcją Archiwizuj
  katalogu), niezależnie od statusu; produkt jedynie wyłączony w kanale kupującego dostaje
  `product_not_found`, jak każdy produkt, którego kupujący nie może tam zamówić.
- Powtórzone SKU są łączone (ilości się sumują); wiersze powyżej `quick_order.import_max_rows` są
  odrzucane. Ustawienie jest ograniczane do zakresu **1–10 000** bez względu na zapisaną wartość.

`POST /api/v1/quick-order/build` zamienia potwierdzone, rozpoznane wiersze w **koszyk**
(`CartService`) albo **zapytanie ofertowe** (`RfqService`), z bieżącymi cenami kupującego z
cenników — wyceną koszyka dla koszyka i cenami referencyjnymi zapytania dla zapytania.
Odpowiedniki w panelu administracyjnym
(`/api/v1/admin/quick-order/import` i `/build`, chronione przez `orders:write`) budują koszyk lub
zapytanie w imieniu wybranego klienta przez `onBehalfOf`.

**Uprawnienia w organizacji.** Import kupującego wymaga `carts.create` **albo**
`quote_requests.create`: z pliku może powstać koszyk lub zapytanie ofertowe, więc podgląd widzi
członek, który może zrobić którekolwiek z nich. Członek bez obu uprawnień dostaje odmowę
`403 ORGANIZATION_PERMISSION_REQUIRED` z kodem `carts.create`, zanim plik zostanie odczytany —
uszkodzony plik dostaje tę samą odpowiedź. Uprawnienie modułu, który jest wyłączony, niczego nie
daje, więc gdy `quote_requests` jest wyłączony, import dopuszcza tylko `carts.create`. Budowanie
przez kupującego wymaga uprawnienia do utworzenia
celu — `carts.create` dla celu `cart`, `quote_requests.create` dla celu `quote_request` —
sprawdzanego na samym początku, zanim pozycje zostaną odczytane. Oba uprawnienia deklarują moduły
`carts` i `quote_requests`; odmowa to `403 ORGANIZATION_PERMISSION_REQUIRED` z nazwą kodu.
Odpowiedniki w panelu są chronione wyłącznie uprawnieniem operatora `orders:write`: operator nie ma
roli w organizacji, więc klient, w którego imieniu powstaje koszyk lub zapytanie, nie jest
sprawdzany. To, co powstanie, jest oceniane, gdy klient z tego skorzysta.

W storefroncie strona szybkiego zamówienia (`/quick-order`) stosuje tę samą regułę. Członek bez obu
kodów zamiast importu widzi wyjaśnienie: *„Twoja rola nie pozwala dodawać produktów do koszyka ani
wysyłać zapytań ofertowych, dlatego szybkie zamówienie jest dla Ciebie niedostępne.”* Po imporcie
**Dodaj wszystko do koszyka** jest dostępne tylko z `carts.create`, a **Wyślij jako zapytanie
ofertowe** — tylko z `quote_requests.create`, więc członek, który ma wyłącznie to drugie, importuje
plik i może jedynie poprosić o ofertę.

**Minimalne ilości zamówienia w pliku.** Podgląd ocenia minimum każdego produktu w sztukach na
**łącznej ilości produktu w całym pliku** — po połączeniu powtórzonych wierszy i zsumowaniu
wszystkich wariantów produktu — nigdy razem z koszykiem kupującego, więc werdykt podglądu i
budowania mogą się różnić. Wiersze odrzucone z innego powodu nie liczą się do żadnej sumy.

- W imporcie **kupującego** każdy wiersz produktu, którego suma w pliku jest poniżej minimum, jest
  odrzucany z powodem `below_minimum`, z `minimum` i `productTotal` użytymi w werdykcie.
- W imporcie **operatora** (trasa panelu) taki wiersz zostaje w `recognized` z
  `warning: { reason: 'below_minimum', minimum, productTotal }`, a podsumowanie liczy go w
  `warningCount`. Ekran zamawiania w imieniu klienta oznacza wiersz plakietką i nadal go buduje — do
  zapytania ofertowego bez zmian, do koszyka z zastrzeżeniem sprawdzenia koszyka.

**Budowanie.** Budowanie z więcej niż **200** pozycjami jest odrzucane w całości z kodem
`422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`, przed czymkolwiek
innym, dla obu celów, tak samo dla kupującego i operatora.

- Cel `cart` dodaje pozycje jedną partią ocenianą razem z koszykiem: pozycje spełniające minima są
  dodawane, pozostałe trafiają do `rejected[]` (`reason: 'below_minimum'`, `kind`, `minimum` oraz
  `packagingUnitName` dla minimum jednostki opakowania). Produkt, którego klient nie może zobaczyć
  albo którego kanał nie publikuje, kończy budowanie jako nieznany produkt, zanim cokolwiek
  zostanie dodane.
- Cel `quote_request` to jedno zapytanie ofertowe, nie partia: budowanie kupującego jest odrzucane
  poniżej minimum jak każde zapytanie ofertowe klienta, a budowanie operatora jest zapisywane z
  pozycjami oznaczonymi dla działu sprzedaży (strona modułu Quote Requests).

**Podgląd między importem a budowaniem.** Sklep przechowuje tu podgląd kupującego, gdy ten go
przegląda i poprawia: `GET /api/v1/quick-order/preview` odpowiada `{ data: preview | null }`, `PUT`
go zastępuje, a `DELETE` usuwa (`204`). Podgląd to odpowiedź importu z poprawkami kupującego. Moduł
trzyma **jeden podgląd na sesję kupującego**, w Redisie, pod kluczem złożonym z organizacji
kupującego, samego kupującego i skrótu sesji. Kupujący z innej organizacji ani ten sam kupujący
zalogowany w innej sesji niczego nie odczytają. Wszystkie trzy wymagają zalogowanego kupującego, a
żaden identyfikator podglądu nie trafia do adresu URL. Zapis wymaga uprawnienia importu
(`carts.create` albo `quote_requests.create`); odczyt i usunięcie własnego podglądu wymagają tylko
sesji.

- **Limit wierszy to `quick_order.import_max_rows`** w chwili zapisu podglądu (ograniczany do
  1–10 000). Liczą się wiersze wczytane przez import, rozpoznane i odrzucone. Wiersze ponad limit
  importu nie są przechowywane pojedynczo: podgląd trzyma je jako jedną liczbę
  `summary.overflowCount`, a limit, który przekroczyły, w `summary.rowLimit`. Sklep pokazuje jeden
  komunikat: *„Wczytano tylko pierwsze 2000 wierszy pliku. Pominięte wiersze: 15. Podziel plik i
  zaimportuj resztę osobno.”*
- Import zawsze się więc mieści. Limit ogranicza tylko to, co dochodzi z wyszukiwania: zapis, który
  powiększa podgląd ponad limit, jest odrzucany z kodem `422 VALIDATION_FAILED`,
  `details: { code: 'too_many_lines', maximum }`, gdzie `maximum` to wartość ustawienia. Zapis, który
  nie dodaje wierszy (zmiana, usunięcie, pozycje pozostawione przez budowanie koszyka), jest
  przyjmowany nawet wtedy, gdy ustawienie obniżono poniżej zapisanego podglądu.
- Treść większa niż 2 MiB jest odrzucana z kodem `413`, niezależnie od ustawienia. Odrzucony zapis
  zostawia poprzedni podgląd bez zmian.
- **Budowanie obejmuje najwyżej 200 pozycji.** Gdy podgląd ma więcej niż 200 rozpoznanych pozycji
  (odrzucone wiersze nie są budowane i się nie liczą), sklep informuje o tym nad przyciskami i
  wyłącza *Dodaj wszystko do koszyka* oraz *Wyślij jako zapytanie ofertowe*, dopóki kupujący nie
  usunie części pozycji albo nie podzieli pliku. Odmowa `too_many_items` przy budowaniu zostaje jako
  zabezpieczenie.
- Podgląd wygasa **godzinę po ostatnim zapisie**. Odczyt tego czasu nie wydłuża. Wygasły podgląd
  odczytuje się jako `null`, a sklep prosi kupującego, by ponownie wkleił listę albo przesłał plik.
- Sklep usuwa podgląd po udanym budowaniu i przy wylogowaniu. Wygasła sesja nie może go już
  wskazać, więc wygasa on sam.
- Gdy moduł jest wyłączony, trzy punkty końcowe odpowiadają `503 MODULE_DISABLED`; zapisane podglądy
  zostają bez zmian i po ponownym włączeniu modułu są znów dostępne, o ile nie minęła ich godzina.

Pliki `.xlsx` są odczytywane przez **`exceljs`** (tylko w backendzie, w osobnym pliku
`excel-importer.ts`); czytany jest tylko pierwszy arkusz.

### 2. Szybkie wyszukiwanie

`GET /api/v1/quick-order/search?q=` dopasowuje według SKU, nazwy produktu oraz wartości atrybutów
oznaczonych jako **`quick_searchable`** (osobna flaga logiczna w `product_attributes`, przełączana w
zarządzaniu atrybutami w panelu). Wartości atrybutów bez tej flagi nigdy nie są dopasowywane.
Wymaga sesji; ograniczone do kanału sprzedaży.

### 3. Domyślne preferencje zamawiania

`quick_order_default_preferences` przechowuje cztery wartości domyślne — metodę płatności, metodę
dostawy, adres do faktury i adres dostawy — dla każdego celu (`scope` = `organization` |
`customer`). Wygrywa wartość najbardziej szczegółowa (ustawienie klienta nadpisuje ustawienie
organizacji, osobno dla każdego pola), a w chwili użycia sprawdzane jest ponownie, czy wartość jest
nadal dopuszczalna (aktywna, dozwolona dla organizacji, adres istnieje — w przeciwnym razie null).

- Storefront: klient zarządza własnymi wartościami domyślnymi (`/preferences`); checkout wstępnie
  wybiera wyznaczone wartości domyślne. Członek z rolą *Administrator* swojej organizacji zarządza
  także zakresem organizacji i wartościami domyślnymi pozostałych członków organizacji. Jest to
  zastrzeżone dla roli *Administrator* — nie jest uprawnieniem, nie można go przyznać innej roli,
  a każdy inny otrzymuje odmowę `403 FORBIDDEN`.
- Panel: `/api/v1/admin/quick-order/preferences` — administrator platformy zarządza dowolnym
  zakresem, a handlowiec tylko przypisanymi organizacjami i ich klientami. Każda zmiana jest
  audytowana.

### 4. Ponowne zamówienie

„Zamów ponownie” przy wcześniejszym zamówieniu tworzy nowy koszyk (`POST /orders/:id/reorder`) albo
nowe zapytanie ofertowe (`POST /orders/:id/clone-to-quote`) po bieżących cenach, zgłaszając
niedostępne pozycje i respektując ustawienie `orders.reorder_enabled`.

### 5. Zakup jednym kliknięciem

Gdy rola kupującego ma uprawnienia **Zakup jednym kliknięciem** (`quick_order.one_click`) **oraz**
składania zamówień bez akceptacji (`carts.order_without_approval`), w kanale sprzedaży kupującego
włączone jest `quick_order.one_click_buy_enabled` **i** kupujący ma wszystkie cztery dopuszczalne
wartości domyślne, strona produktu pokazuje przycisk „Kup jednym kliknięciem”. Pomija on koszyk i checkout: zamówienie jest składane z wartości domyślnych,
a kupujący trafia tam, gdzie wskazuje `nextAction` płatności (przekierowanie do bramki albo strona
zamówienia lub sukcesu, gdy krok płatności nie jest potrzebny).

Koszyk kupującego pozostaje nietknięty. Produkt trafia do osobnego koszyka roboczego (*Koszyki
robocze* modułu koszyków) przez metodę koszyka `addItems` z `workingBasket: true`
i `onBelowMinimum: 'throw'`, a `OrderService.placeOrder` składa zamówienie z tego koszyka. To, co
kupujący miał w koszyku — także pozycje wypełnione z zaakceptowanego zapytania ofertowego —
pozostaje tam później. Pozycja odrzucona przed zapisem — poniżej minimalnej ilości zamówienia, bez
ceny albo dostępna tylko przez zapytanie ofertowe — niczego nie zapisuje. Odmowa przy składaniu
zamówienia, już po zapisaniu pozycji (stan magazynowy, organizacja, metoda płatności lub dostawy),
ponownie usuwa koszyk roboczy.

Obowiązują te same warunki co przy zwykłym zamówieniu (aktywna organizacja, wartość minimalna, limit
kredytowy, stan magazynowy, minimalna ilość zamówienia). Dla produktu `simple` lub `configurable` z
minimalną ilością zamówienia jedno kliknięcie zamawia to minimum zamiast 1.

**Kto może kupić jednym kliknięciem.** Zakup jednym kliknięciem to uprawnienie organizacji
`quick_order.one_click`, deklarowane przez ten moduł i domyślne dla członka. Wymaga też
`carts.order_without_approval`: członek, którego koszyki wymagają akceptacji, nie może jej w ten
sposób ominąć. `GET /api/v1/quick-order/one-click/eligibility` sprawdza rolę najpierw, w tej
kolejności:

| `reason` | Kiedy |
| --- | --- |
| `permission_required` | rola nie ma `quick_order.one_click` (także gdy nie ma żadnego z dwóch) |
| `cart_approval_required` | rola ma je, ale nie ma `carts.order_without_approval` |
| `setting_disabled` | ustawienie jest wyłączone dla kanału |
| `missing_defaults` | jedna z czterech wartości domyślnych nie daje się wyznaczyć |

`POST /api/v1/quick-order/one-click` jest odrzucane według tej samej zasady, zanim koszyk roboczy
zostanie zapisany: `403 ORGANIZATION_PERMISSION_REQUIRED` z kodem `quick_order.one_click` albo
`carts.order_without_approval`, gdy brakuje tylko tego drugiego. Kupujący odrzucony z powodu
ustawienia lub wartości domyślnych otrzymuje odpowiedź `422 ONE_CLICK_UNAVAILABLE` z powodem z
oceny dostępności jako `details.code` (`setting_disabled` albo `missing_defaults`) i ponownie jako
`details.reason`, w języku kupującego. Do zgłoszenia #641 była to odpowiedź
`422 VALIDATION_FAILED` z `details.code: 'one_click_unavailable'` i angielskim zdaniem. Storefront
ukrywa przycisk, gdy tylko odpowiedź jest negatywna. Po wyłączeniu modułu jego uprawnienie znika
z edytora ról i z efektywnych uprawnień każdego członka; przyznane uprawnienia pozostają zapisane i obowiązują
ponownie po włączeniu modułu.

Przy aktualizacji rola *Członek* organizacji otrzymuje `quick_order.one_click` tylko tam, gdzie
otrzymuje `carts.order_without_approval` — czyli tylko w organizacji, która nie wymagała
akceptacji koszyków.

## Ustawienia

| Kod | Typ | Wartość domyślna | Zakres |
|------|------|---------|-------|
| `quick_order.one_click_buy_enabled` | boolean | `false` | dla kanału sprzedaży |
| `quick_order.import_max_rows` | number | `2000` (ograniczane do 1–10 000) | globalnie |

## Dane

- Nowa tabela `quick_order_default_preferences` (migracja `20260611T140359_quick_order_default_preferences.ts`).
- Podgląd kupującego jest tylko w Redisie, pod `b2b:quick_order:preview:*`, z czasem życia jednej
  godziny; nie trzyma go żadna tabela.
- Nowa kolumna `product_attributes.quick_searchable` (migracja `20260611T140400_catalog_attribute_quick_searchable.ts`,
  należy do `catalog`).

## Zależności

Korzysta z `orders` (rdzeń zamawiania), `carts`, `quote_requests`, `organizations`,
`payment_methods`, `delivery_methods`, `catalog`, `addresses` i `settings`. Moduł `orders` **nie**
zależy od `quick_order`; zakup jednym kliknięciem dostaje `OrderService` przez leniwy getter
podłączony przy kompozycji.

---
title: Klienci
description: Cykl życia klienta na bazie `customer_accounts` — organizacje firmowe i prywatne, przypisanie handlowca i obsługa klientów w panelu administracyjnym
---

# Klienci (`customers`)

Logika biznesowa cyklu życia klienta, zbudowana na module danych `customer_accounts`. **Każdy klient
należy do organizacji** — firmowej w przypadku B2B albo jednoosobowej *organizacji prywatnej* w
przypadku osoby fizycznej — a `customer_accounts.organization_id` ma ograniczenie `NOT NULL`.
„Samodzielny” oznacza w tym dokumencie *poza organizacją firmową*, a nigdy *bez organizacji*: taki
klient jest osobnym tenantem, a funkcje związane z organizacją, które oferuje firma (zaproszenia,
limit kredytowy, przypisanie handlowca), po prostu w jego przypadku nie występują,
zamiast być wyłączane jako przypadek szczególny.

## Możliwości

**Storefront (samoobsługa)**

- Samodzielna rejestracja, dostępna zależnie od ustawienia
  `customers.allow_registration_without_organization` w danym kanale sprzedaży: obowiązuje wartość
  ustawiona dla kanału, do którego należy żądanie, a w jej braku wartość dla wszystkich kanałów. Po
  udanej rejestracji konto i jego organizacja prywatna są zapisywane w jednej transakcji, a nowe
  konto jest automatycznie logowane. Gdy
  ustawienie jest wyłączone, strona `/register-customer` w sklepie zamiast formularza pokazuje
  komunikat z linkiem do rejestracji organizacji, więc odwiedzający nie wypełnia formularza, który
  zostałby odrzucony.
- Pierwsze logowanie przez zewnętrznego dostawcę tożsamości (np. Google) zakłada konto według tego
  samego ustawienia, odczytanego dla kanału sprzedaży, w którym logowanie rozpoczęto. Gdy w tym
  kanale ustawienie jest wyłączone, konto nie powstaje, a odwiedzający wraca na stronę logowania z
  prośbą o wcześniejsze założenie konta.
- Jedna książka adresowa dla każdego klienta: książka jego organizacji. Klient indywidualny widzi ją
  jako *Moje adresy* (`/addresses`), członek firmy jako *Adresy organizacji*
  (`/organization/addresses`). Kasa proponuje adresy z tej samej książki i do niej zapisuje nowe.
  Obsługuje ją moduł `organizations` na bazie `addresses`, nie ten moduł, więc działa także wtedy,
  gdy ten moduł jest wyłączony.
- Domyślna metoda płatności i metoda dostawy. Adresy domyślne są odczytywane z książki organizacji,
  w której się je ustawia.
- Zmiana hasła; historia własnych zamówień i zapytań ofertowych tylko do odczytu.

**Panel administracyjny (nadzór)**

- Lista klientów (wyszukiwanie oraz filtry statusu, organizacji i grupy) i widok szczegółów z datą
  utworzenia, grupą klientów, organizacją, stanem blokady i ostatnim logowaniem.
- Blokowanie i odblokowanie oraz usunięcie miękkie i przywrócenie, z uprawnieniami zależnymi od roli:
  administrator platformy może działać na każdym kliencie; poza nim uprawniony jest handlowiec
  przypisany do organizacji klienta. Organizacja prywatna nigdy nie ma przypisanego handlowca, więc
  reguła dla nieprzypisanych organizacji sprawia, że samodzielnym klientem może zająć się dowolny
  handlowiec. Zabezpieczenie odmawia zablokowania, usunięcia lub odłączenia ostatniego aktywnego
  członka z rolą Administrator organizacji firmowej (`409 ORG_OWNER_DEPLETION`);
  zablokowani administratorzy się nie liczą. Nie dotyczy
  organizacji prywatnej, której jedyny członek ma rolę Administrator: zablokowanie lub usunięcie
  takiego klienta jest dozwolone.
- Logowanie jako klient; audytowane jako `impersonation.start` / `impersonation.end`. Odpowiedź
  podaje `organizationRole` klienta, a logowanie jako klient działa dokładnie z jego uprawnieniami
  w organizacji.
- Reset hasła z poziomu panelu (e-mail z linkiem do ustawienia hasła).
- Walidacja NIP/VAT (VIES, port Białej listy).
- Przypisanie do organizacji i odłączenie od organizacji, które przenosi klienta do jego własnej
  organizacji prywatnej, zamiast zostawiać go bez organizacji. Bezpośrednie przypisanie grupy
  klientów (zastępuje grupę organizacji przy wyznaczaniu cen i promocji).
- Panele zamówień, zapytań ofertowych i koszyków (bieżących i porzuconych), tylko do odczytu.
- Widok „klienci online” oparty na ostatniej aktywności sesji.

## Usuwanie i anonimizacja

Usunięcie to miękkie wyłączenie konta: logowanie jest odrzucane, konto ukryte, sesje unieważnione, a
zamówienia, zapytania ofertowe i historia audytu zachowane. W konfigurowalnym okresie
(`customers.deletion_retention_days`, domyślnie 365 dni) uprawniona osoba może przywrócić konto. Po
jego upływie zadanie anonimizacji (`AnonymizationSweepWorker`) nieodwracalnie usuwa dane osobowe i
przywrócenie nie jest już możliwe: od chwili upływu okresu przywrócenie kończy się odpowiedzią
`409 CUSTOMER_RESTORE_WINDOW_ELAPSED`, nawet jeśli zadanie nie dotarło jeszcze do tego konta. Konto
traci adres e-mail, imię i nazwisko, hasło oraz wszystkie wartości pól niestandardowych. W
przypadku klienta indywidualnego zadanie anonimizuje też jego organizację prywatną: czyści jej
nazwę, adres rejestrowy, nazwę prawną, adresy e-mail do potwierdzeń zamówień i wszystkie wartości
pól niestandardowych, a wszystkie jej zapisane adresy, także te, które klient wcześniej usunął,
są czyszczone (`-`, bez telefonu, kraj zostaje) i miękko usuwane (usunięty adres zachowuje datę
usunięcia), każdy z wpisem audytu `address.anonymized`. Dzieje się tak również wtedy, gdy
operator usunął już tę organizację. Złożone zamówienia zachowują swoje kopie adresów. Wpisy audytu
anonimizacji odnotowują, że dane usunięto, ale nie przechowują samych danych.

Usuwane są też uzasadnienia, które operatorzy zapisali o kliencie: powód zablokowania konta, a w
przypadku klienta indywidualnego także powody zablokowania i odrzucenia jego organizacji
prywatnej. Organizacja firmowa zachowuje swoje powody. Sama blokada lub odrzucenie zostaje, więc
ekrany klienta nadal pokazują status i jego datę, ale bez powodu. Wpisy audytu anonimizacji
odnotowują jedynie, że powód istniał. Wpisy audytu zapisane wcześniej, takie jak wpis samej
blokady, zachowują zapisane wartości, w tym powód, dopóki wcześniejsze wpisy nie będą redagowane
przy anonimizacji ([#844](https://github.com/endora-commerce/endora-commerce/issues/844)).

Zadanie usuwa też uzasadnienia, które operatorzy i osoby akceptujące podali, odrzucając koszyki tego
konta; każdy koszyk zachowuje swój status. Co jest usuwane, a co zostaje, opisuje moduł koszyków
(*Przechowywanie historii zmian*).

Zadanie uruchamia się raz dziennie w procesie workera i tylko wtedy, gdy moduł jest włączony, więc
konto zostaje zanonimizowane najpóźniej dzień po upływie okresu. Gdy moduł jest wyłączony, zadanie
się nie uruchamia; konta, którym okres upłynął w tym czasie, anonimizuje pierwszy przebieg po
ponownym włączeniu modułu. Przebieg najpierw sprawdza, czy jakieś konto czeka na anonimizację albo czy
jakaś wcześniejsza anonimizacja pozostała do dokończenia; jeśli nie, nic nie robi i nie zapisuje
wpisu audytu. Gdy tego nie da się sprawdzić, przebieg i tak się odbywa. Dwa nakładające się przebiegi anonimizują konto
tylko raz.

Zadanie najpierw anonimizuje organizację prywatną i jej adresy, a konto na końcu. Jeśli przebieg
zostanie przerwany, konto zostanie podjęte ponownie w następnym przebiegu, który dokończy brakujące
kroki bez powtarzania wpisów audytu kroków już wykonanych. Konto, którego nie da się
zanonimizować, nie wstrzymuje pozostałych: przebieg anonimizuje resztę, a następnie zgłasza
identyfikatory kont, których nie udało się przetworzyć.

Tak samo jest, gdy zakres usuwanych danych się poszerza. Wszystko, co przebieg z wcześniejszej
wersji pozostawił na zanonimizowanym koncie lub w jego organizacji prywatnej, na przykład wartości
pól niestandardowych, nazwę prawną, adresy e-mail do potwierdzeń zamówień albo powód zablokowania
lub odrzucenia, usuwa następny przebieg, niezależnie od obecnego ustawienia okresu przechowywania.
Ten przebieg zapisuje po jednym dodatkowym wpisie audytu dla każdego zmienionego rekordu, zachowuje
pierwotną datę anonimizacji i nie ogłasza anonimizacji ponownie, więc to, co inne moduły robią przy
anonimizacji, na przykład usuwanie zgłoszeń klienta przez moduł Formularze, nie jest wykonywane
drugi raz.

## Wycofanie osobistej książki adresowej

Do pierwszego wydania tej zmiany moduł prowadził drugą, *osobistą* książkę adresową
(`customer_addresses`). Na żaden jej adres nie dało się złożyć zamówienia. Zostaje wycofana dla
wszystkich, w dwóch wydaniach:

- **Wydanie 1 (to).** Każdy dawny punkt końcowy osobistej książki odpowiada `410 Gone` z kodem
  `CUSTOMER_ADDRESS_BOOK_RETIRED`, po polsku lub po angielsku. Jednorazowe zadanie w tle,
  uruchamiane przez proces workera, gdy ten moduł jest włączony, przetwarza pozostałe wiersze:
  - wiersze klienta indywidualnego są **przenoszone** do książki jego organizacji prywatnej. Adres,
    który już w niej jest, nie jest kopiowany drugi raz, a istniejący adres domyślny pozostaje
    domyślny. Każdy wiersz ma wpis audytu `customer_address.merge`;
  - każdy inny wiersz (członka firmy, klienta indywidualnego, którego organizacja prywatna została już
    zanonimizowana, albo konta, którego organizacji nie da się znaleźć) jest **usuwany**: czyszczony, miękko usuwany i audytowany jako `customer_address.erased`;
  - wiersz, którego książka adresowa nie przyjmuje — na przykład z krajem, który nie jest już
    aktywny — zostaje, oznaczony powodem (`customer_address.merge_refused`). Widzi go tylko
    operator, na karcie *Adresy* klienta.
- **Wydanie 2.** Tabela i pozostały kod są usuwane. Aktualizacja odmawia, dopóki zostaje choćby
  jeden wiersz.

Stronę operatora opisuje uwaga do aktualizacji *Wycofanie osobistej książki adresowej (wydanie 1 z
2)*.

Gdy zadanie anonimizacji anonimizuje konto, w ten sam sposób czyści też każdy wiersz tego konta w tej
książce, niezależnie od tego, czy wiersz został przeniesiony, usunięty przez zadanie, usunięty przez
klienta czy odrzucony, z jednym wpisem audytu `customer_address.anonymized` na wiersz. Dotyczy to
każdego konta, także członka firmy.

## API publiczne

Trasy administracyjne są chronione przez `customers:read` (odczyt), `customers:manage` (zmiany) i
`customers:impersonate` (logowanie jako klient).

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `POST /api/v1/customers/register` | anonimowy | Samodzielna rejestracja (zależna od ustawienia) |
| `GET /api/v1/storefront/settings/customer-registration` | anonimowy | Czy samodzielna rejestracja jest dostępna (`allowRegistrationWithoutOrganization`) |
| `GET /api/v1/me/customer` | klient | Własny profil z `organizationRole` i faktycznymi uprawnieniami `permissions` |
| `POST /api/v1/me/customer/change-password` | klient | Zmiana hasła. Udana zmiana wylogowuje konto ze wszystkich pozostałych sesji (sesja, z której wysłano żądanie, zostaje), unieważnia niewykorzystane tokeny resetu hasła i wycofuje każde rozpoczęte, a niedokończone logowanie. |
| `GET/POST /api/v1/me/customer/addresses` · `PATCH/DELETE .../:id` · `PUT .../:id/default` | klient | Wycofane: `410 CUSTOMER_ADDRESS_BOOK_RETIRED`. Używaj `/api/v1/organizations/mine/addresses` |
| `GET /api/v1/me/customer/defaults` | klient | Domyślna metoda płatności i dostawy oraz adresy domyślne z książki organizacji |
| `PUT /api/v1/me/customer/defaults` | klient | Ustawienie domyślnej metody płatności i dostawy. Treść podająca `billingAddressId` lub `shippingAddressId` dostaje odpowiedź `410 CUSTOMER_ADDRESS_BOOK_RETIRED` |
| `GET /api/v1/me/customer/orders` | klient | Własna historia zamówień |
| `GET /api/v1/me/customer/quote-requests` | klient | Własna historia zapytań ofertowych |
| `GET /api/v1/admin/customers` | administrator | Lista (ograniczona uprawnieniami) |
| `GET /api/v1/admin/customers/:id` | administrator | Szczegóły |
| `POST /api/v1/admin/customers/:id/block` · `/unblock` | administrator | Blokowanie / odblokowanie |
| `DELETE /api/v1/admin/customers/:id` · `POST .../restore` | administrator | Usunięcie miękkie / przywrócenie |
| `POST /api/v1/admin/customers/:id/impersonate` | administrator | Rozpoczęcie logowania jako klient |
| `POST /api/v1/admin/customers/:id/password-reset` | administrator | E-mail z linkiem do ustawienia hasła |
| `POST/DELETE /api/v1/admin/customers/:id/organization` | administrator | Przypisanie do organizacji / odłączenie |
| `PUT /api/v1/admin/customers/:id/customer-group` | administrator | Ustawienie / usunięcie grupy klientów |
| `GET /api/v1/admin/customers/:id/addresses` | administrator | Tylko do odczytu: `{ organization, personal }` — książka organizacji oraz wiersze osobistej książki, których zadanie nie przeniosło, każdy z `mergeRefusal` |
| `POST /api/v1/admin/customers/:id/addresses` | administrator | Wycofane: `410 CUSTOMER_ADDRESS_BOOK_RETIRED` |
| `POST /api/v1/admin/customers/:id/vat-validate` | administrator | Walidacja numeru NIP/VAT |
| `GET /api/v1/admin/customers/:id/orders` · `/quote-requests` · `/carts` | administrator | Panele historii tylko do odczytu |
| `GET /api/v1/admin/customers/online` | administrator | Klienci obecnie online |

## Ustawienia

| Kod | Typ | Wartość domyślna | Przeznaczenie |
| --- | --- | --- | --- |
| `customers.allow_registration_without_organization` | boolean | `false` | Włącza samodzielną rejestrację w danym kanale sprzedaży |
| `customers.deletion_retention_days` | number | `365` | Okres, w którym można przywrócić konto przed trwałą anonimizacją |
| `customers.presence_freshness_minutes` | number | `10` | Próg uznania klienta za „online” |

## Schemat

- `20260611T140403_customer_accounts_lifecycle.ts` (należy do `customer_accounts`) — dodaje do `customer_accounts` kolumny `customer_group_id`,
  stan blokady (`blocked_at`, `block_reason`, `block_source`, `blocked_by_*`) oraz stan usunięcia i
  anonimizacji (`deletion_requested_by_admin_user_id`, `anonymized_at`).
- `20260611T140404_customers_customer_addresses_init.ts` — tabela `customer_addresses` (jeden adres domyślny dla każdej pary
  `(customer, kind)`), czyli wycofana osobista książka adresowa.
- `20261105T180317_customers_address_book_retirement.ts` — kolumny pochodzenia, które zapisuje zadanie wycofania
  (`merged_into_address_id`, `merged_at`, `merge_refusal`), oraz indeks wierszy, które zadanie ma jeszcze przetworzyć.
  Wydanie 2 usuwa tabelę.

Domyślne preferencje płatności i dostawy korzystają z istniejącej tabeli
`quick_order_default_preferences`; nowa tabela nie jest tworzona.

## Wyszukiwanie globalne

Wyszukiwanie globalne w panelu administracyjnym (paleta poleceń, ⌘K / Ctrl+K) znajduje klientów. Ten moduł udostępnia poniższe pola; to, które z nich są używane, wybiera się na ekranie konfiguracji wyszukiwania globalnego.

| Pole | Przeszukiwane domyślnie |
| --- | --- |
| E-mail | tak |
| Imię i nazwisko | tak |

Wynik pokazuje imię i nazwisko, e-mail, organizację oraz informację, czy konto jest zablokowane, a jego wybranie otwiera klienta. Konta usunięte i zanonimizowane nie są znajdowane. Klienci pojawiają się dla roli z uprawnieniem `customers:read`, a przedstawiciel handlowy widzi tych klientów, których pokazuje mu lista klientów.

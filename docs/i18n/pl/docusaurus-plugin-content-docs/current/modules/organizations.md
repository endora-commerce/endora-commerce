---
title: organizations
description: Organizacje klientów, rejestracja, zaproszenia
---

# `organizations`

Organizacje klientów — rejestracja, weryfikacja e-mailem, zarządzanie członkami, zaproszenia i
zawieszanie. Pierwszy użytkownik rejestrujący organizację otrzymuje jej rolę Administrator
(zob. *Role* niżej).

## API publiczne

Trasy oznaczone *administrator organizacji* są zastrzeżone dla członka z rolą Administrator
organizacji — sprawdza to serwer przez `organizationPermissionPort.isAdministrator` i odmawia
z `403 FORBIDDEN`; żadne uprawnienie ich nie nadaje (zob. *Role* niżej). Trasy administracyjne
platformy (`/api/v1/admin/*`) są chronione przez `customers:manage`.

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `POST /api/v1/organizations/register` | anonimowy | Rejestracja organizacji i jej pierwszego członka, wysłanie e-maila weryfikacyjnego |
| `POST /api/v1/auth/email-verification/verify` | anonimowy | Użycie tokenu weryfikacyjnego |
| `POST /api/v1/auth/customer/login` | anonimowy | Logowanie klienta → ustawia ciasteczko `b2b_session`; łączy koszyk anonimowy |
| `POST /api/v1/auth/customer/logout` | klient | Zakończenie sesji |
| `POST /api/v1/auth/password-reset/request` | anonimowy | Zawsze 202 (ochrona przed sprawdzaniem, czy konto istnieje) |
| `POST /api/v1/auth/password-reset/confirm` | anonimowy | Użycie tokenu resetu z e-maila. Wykorzystanie tokenu wylogowuje konto ze **wszystkich** sesji, unieważnia pozostałe niewykorzystane tokeny resetu i wycofuje każde rozpoczęte, a niedokończone logowanie. |
| `GET /api/v1/me` | klient | Bieżący klient (z `organizationRole` i `permissions`) i jego organizacja oraz `impersonation: { impersonatorAdminUserId }`, gdy administrator działa jako kupujący |
| `POST /api/v1/me/password` | klient | Zmiana hasła (odrzucana przy błędnym `currentPassword`). Udana zmiana wylogowuje konto ze wszystkich pozostałych sesji (sesja, z której wysłano żądanie, zostaje), unieważnia niewykorzystane tokeny resetu hasła i wycofuje każde rozpoczęte, a niedokończone logowanie. |
| `GET /api/v1/organizations/mine/members` | administrator organizacji | Lista członków, każdy z `organizationRole` |
| `DELETE /api/v1/organizations/mine/members/:id` | administrator organizacji | Usunięcie członka (z ochroną ostatniego administratora) |
| `PATCH /api/v1/organizations/mine/members/:id/role` | administrator organizacji | Przypisanie roli (`{ roleId }`; z ochroną ostatniego administratora) |
| `GET /api/v1/organizations/mine/invitations` | administrator organizacji | Lista oczekujących zaproszeń (nieprzyjętych, nieunieważnionych i niewygasłych), każde z `organizationRole` |
| `POST /api/v1/organizations/mine/invitations` | administrator organizacji | Zaproszenie nowego użytkownika (`{ email, roleId? }`, domyślnie rola Członek); e-mail z linkiem wysyła wstrzyknięty mechanizm poczty |
| `DELETE /api/v1/organizations/mine/invitations/:id` | administrator organizacji | Unieważnienie oczekującego zaproszenia |
| `POST /api/v1/organizations/invitations/:token/accept` | anonimowy | Przyjęcie zaproszenia, utworzenie konta klienta z rolą wskazaną w zaproszeniu |
| `GET /api/v1/organizations/mine/addresses` | klient | Lista adresów dostawy i do faktury |
| `POST /api/v1/organizations/mine/addresses` | klient (`addresses.manage`) | Utworzenie adresu |
| `PATCH /api/v1/organizations/mine/addresses/:id` | klient (`addresses.manage`) | Aktualizacja |
| `DELETE /api/v1/organizations/mine/addresses/:id` | klient (`addresses.manage`) | Usunięcie |
| `GET /api/v1/admin/organizations` | administrator | Lista z `filter[status]` / `filter[vatStatus]` / `q` |
| `POST /api/v1/admin/organizations` | administrator (`customers:manage`) | Utworzenie organizacji z jej kanałami sprzedaży (zob. *Kanały sprzedaży* niżej) |
| `GET /api/v1/admin/organizations/sales-channel-options` | administrator (`customers:manage`) | Kanały oferowane w formularzu tworzenia |
| `GET /api/v1/admin/organizations/:id/sales-channels` | administrator (`customers:read` lub `customers:manage`) | Kanały przypisane do organizacji i kanały, które można jej przypisać. Przedstawiciel handlowy widzi tylko przypisane mu organizacje; każda inna odpowiada `404 NOT_FOUND`, jak organizacja, która nie istnieje |
| `PUT /api/v1/admin/organizations/:id/sales-channels` | administrator (`customers:manage`) | Zastąpienie przypisanych kanałów (`{ salesChannelIds }`, co najmniej jeden); `404 NOT_FOUND` poza organizacjami przedstawiciela handlowego, jak przy odczycie |
| `GET /api/v1/admin/organizations/:id` | administrator | Organizacja z listą członków (`updatedAt`, członkowie z `lastLoginAt` i `organizationRole`; `predefinedRoles` podaje role Administrator i Członek) |
| `PATCH /api/v1/admin/organizations/:id` | administrator | Zmiana nazwy, `status` lub `vatStatus`; opcjonalne `expectedUpdatedAt` → `409 VERSION_CONFLICT`, gdy dane są nieaktualne |
| `POST /api/v1/admin/organizations/:id/members/invite` | administrator | Zaproszenie e-mailem (`{ email, roleId? }`, domyślnie rola Członek; z poziomu platformy) |
| `POST /api/v1/admin/organizations/:id/members` | administrator | Bezpośrednie utworzenie członka z hasłem (`roleId?`, domyślnie rola Członek) |
| `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role` | administrator | Przypisanie roli (`{ roleId, expectedUpdatedAt? }`) |
| `DELETE /api/v1/admin/organizations/:id/members/:customerAccountId` | administrator | Usunięcie miękkie członka (z ochroną ostatniego administratora) |
| `POST /api/v1/admin/organizations/:id/recover-admin-access` | administrator | Procedura awaryjna — nadanie istniejącemu członkowi roli Administrator |

Ustaw **`SMTP_URL`** w środowisku backendu, aby poczta była wysyłana przez SMTP, a nie wypisywana do
konsoli.

## Encje

`Organization`, `OrganizationInvitation`, `EmailVerificationToken`. Unikalności NIP pilnuje baza
danych; powtórna rejestracja zwraca `409 ORGANIZATION_TAX_ID_EXISTS`.

## Emitowane zdarzenia

`organization.registered.v1`, `organization.verified.v1`, `organization.suspended.v1`,
`organization.member_invited.v1`, `organization.member_role_changed.v1`.

## Punkty rozszerzenia

- **Wysyłka weryfikacji** — `email-verification-service.ts` udostępnia wymienny interfejs wysyłki
  poczty; w kompozycji produkcyjnej zastąp wypisywanie do konsoli prawdziwym sterownikiem SMTP lub
  SendGrid.
- **Ochrona ostatniego administratora** — zapisana w `role-service.ts#changeRole` i
  `invitation-service.ts#revoke`; nowe miejsca, w których „musi zostać co najmniej jeden
  administrator”, dodawaj właśnie tam.

## Kanały sprzedaży

Członkowie organizacji mogą logować się i kupować dokładnie w tych sklepach, których kanały
sprzedaży są przypisane do organizacji. Brak przypisania oznacza brak dostępu; organizacja zawsze
zachowuje co najmniej jeden kanał.

- **Logowanie.** Członek, którego organizacja nie jest przypisana do sklepu, w którym się loguje,
  dostaje odmowę `403 SALES_CHANNEL_NOT_PERMITTED` — *„To konto nie ma dostępu do tego sklepu.”* — po
  sprawdzeniu hasła, a przed prośbą o drugi składnik i utworzeniem sesji. Logowanie przez
  zewnętrznego dostawcę tożsamości jest odrzucane tak samo i wraca na stronę logowania sklepu z tym
  komunikatem. Błędne hasło nadal dostaje najpierw `401`, więc odmowa nie zdradza niczego o
  przypisaniach komuś, kto nie zna hasła.
- **Zalogowany, gdy dostęp zostaje odebrany.** Następna strona członka w tym sklepie pokazuje ekran
  *Brak dostępu do tego sklepu* z listą sklepów, z których może korzystać, i przyciskiem
  wylogowania.

### Kto dostaje który kanał

| Jak powstaje organizacja | Przypisane kanały |
| --- | --- |
| Rejestracja firmy w storefroncie (`POST /api/v1/organizations/register`) | dokładnie kanał sklepu, w którym się zarejestrowała — także w sklepie zamkniętym dla niezalogowanych odwiedzających, gdzie o wejściu firmy decyduje moderacja |
| Samodzielna rejestracja klienta indywidualnego (organizacja prywatna) | dokładnie kanał sklepu, w którym się zarejestrował; w sklepie zamkniętym dla niezalogowanych odwiedzających odrzucana |
| *Nowa organizacja* w panelu administracyjnym | kanały wybrane w formularzu |
| Każda inna ścieżka — logowanie przez zewnętrznego dostawcę tożsamości, które zakłada nowe konto, importy, dane demonstracyjne | domyślny kanał systemowy |

Przyjęcie zaproszenia dodaje członka do istniejącej organizacji i nie zmienia żadnego z jej kanałów.

Przy wprowadzeniu tej reguły każda istniejąca organizacja otrzymała domyślny kanał systemowy oraz
każdy kanał, w którym miała już zamówienia.

### W panelu administracyjnym

- **Panel Kanały sprzedaży** — na stronie organizacji. Z uprawnieniem `customers:manage` to lista
  wielokrotnego wyboru z przyciskiem **Zapisz kanały sprzedaży**; bez niego — lista tylko do odczytu.
  Nieaktywne kanały są oznaczone *(nieaktywny)*, a domyślny kanał systemowy ma etykietę. Zapis pustego
  wyboru jest odrzucany: *„Organizacja musi mieć przypisany co najmniej jeden kanał sprzedaży.”*
  Każdy dodany lub usunięty kanał zapisuje jeden wpis w dzienniku audytu. Zmiana obowiązuje od razu na
  serwerze, który ją zapisał, a na każdym innym serwerze w ciągu 30 sekund.
- **Nowa organizacja** — przycisk na liście organizacji i akcja w palecie poleceń (⌘K / Ctrl+K),
  widoczne z uprawnieniem `customers:manage`. Formularz pyta o nazwę, NIP, adres siedziby, status
  (*Aktywna* lub *Oczekuje na weryfikację*) i kanały sprzedaży, z domyślnym kanałem systemowym
  zaznaczonym na starcie. Utworzenie to jedno polecenie zapisywane w dzienniku audytu; po zapisie
  otwiera się strona nowej organizacji. Członków zaprasza się z tej strony, gdy organizacja już
  istnieje.

## Organizacja jako strona transakcji i jej moderacja

Organizacja jest pełnoprawną stroną transakcji handlowych. Ta sekcja opisuje, jak to działa.

### Status (`pending_verification` → `active` → `blocked` / `rejected`)

Każda nowo zarejestrowana organizacja zaczyna w stanie `pending_verification`. Ustawienie dla całej
platformy `organizations.moderation.mode` (`manual` / `auto`) decyduje, czy przed pierwszą
transakcją administrator musi ją ręcznie zatwierdzić. Gdy status jest inny niż `active`, platforma
odrzuca składanie zamówień, wysyłanie zapytań ofertowych i dodawanie pozycji do koszyka z HTTP 423.

Dawny status `suspended` zmieniono na `blocked` w migracji
`20260611T140349_organizations_consolidation.ts`, która w każdym przepisanym wierszu zapisuje
wyjaśniający `blocked_reason` (nie tworzy wpisu w dzienniku audytu).

Endpointy administracyjne:

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/admin/organizations/:id/approve` | Przejście `pending_verification` → `active` |
| `POST /api/v1/admin/organizations/:id/reject` | Przejście `pending_verification` → `rejected` (końcowe) |
| `POST /api/v1/admin/organizations/:id/block` | Przejście `active` → `blocked` (decyzja operatora) |
| `POST /api/v1/admin/organizations/:id/unblock` | Przejście `blocked` → `active` |

Każda treść żądania zawiera `expectedVersion: number` (token blokady optymistycznej z kolumny
`organizations.version`), a operacja jest wykonywana w `em.transactional`. Nieaktualne
`expectedVersion` zwraca `409 VERSION_CONFLICT` z `currentVersion` w treści. Niedozwolone przejście
statusu (np. zatwierdzenie już aktywnej organizacji) zwraca `422 VALIDATION_FAILED`.

Po stronie klienta: storefront dostaje przetłumaczony komunikat „dlaczego nie możesz składać
zamówień” w polach `organization.canTransact` i `organization.moderationMessage` z `GET /api/v1/me`.
Ten komunikat, podobnie jak `reason` w odpowiedzi 423 ze wstępnej weryfikacji checkoutu, jest
napisany w języku, w którym udzielana jest odpowiedź (`Accept-Language` storefrontu, a w jego braku
domyślny język kanału sprzedaży), na podstawie kluczy `moderation.*` z bundla tego modułu.
Strony koszyka i checkoutu wyświetlają nad formularzem `<OrganizationModerationBanner>`, gdy
`canTransact === false`.

### Powiadomienia w panelu

Za powiadomienia w panelu (ikonę dzwonka) odpowiada niewielki moduł `admin_notifications`. Przy
każdej nowej rejestracji organizacji `OrgRegistrationNotifier` zapisuje jedno powiadomienie dla
wszystkich (`audience='all_admins'`, `kind='organization.registered'`) i wysyła po jednym e-mailu na
każdy adres z ustawienia `organizations.notifications.new_registration_recipients`. Panel odpytuje
`GET /api/v1/admin/notifications` co 30 s.

Wpis w dzwonku zawiera tekst angielski oraz klucze `notifications.newRegistration.*` z bundla tego
modułu, więc każdy administrator czyta go we własnym języku. E-mail korzysta z szablonu
`new_org_registration`, jeśli taki jest zdefiniowany; w przeciwnym razie moduł składa go sam, z tego
samego bundla, w języku domyślnego systemowego kanału sprzedaży.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/notifications` | Stronicowana lista z `isRead` wyznaczanym dla każdego administratora |
| `POST /api/v1/admin/notifications/:id/read` | Oznaczenie jednego powiadomienia jako przeczytanego |
| `POST /api/v1/admin/notifications/mark-all-read` | Oznaczenie wszystkich widocznych jako przeczytane |

### Ograniczenia handlowe organizacji

Trzy listy dozwolonych wartości określają, z czego organizacja może korzystać w checkoucie:

- `organization_payment_methods` (tabela łącząca `(organization_id, payment_method_id)`)
- `organization_delivery_methods` (tabela łącząca `(organization_id, delivery_method_id)`)
- `organization_warehouses` (tabela łącząca `(organization_id, warehouse_id)`)

**Pusta lista ⇒ obowiązują ustawienia domyślne platformy.** Niepusta lista filtruje w storefroncie
`GET /api/v1/payment-methods`, `GET /api/v1/delivery-methods` oraz endpointy stanów magazynowych,
ograniczając je do części wspólnej z przypisaniami organizacji wywołującego.

Listy metod płatności i dostawy obowiązują także przy **składaniu zamówienia**: zamówienie dla
organizacji, które wskazuje metodę spoza niepustej listy, jest odrzucane odpowiedzią
`400 VALIDATION_FAILED` wszędzie tam, gdzie zamówienie się składa lub podgląda — w checkoucie
storefrontu, przy tworzeniu zamówienia przez administratora w imieniu klienta i przy przyjęciu
zamówienia kluczem API — a zakup jednym kliknięciem nie jest oferowany, dopóki metoda domyślna jest
wykluczona. Kody odmowy opisuje moduł `orders`, *Listy dozwolonych metod przy składaniu zamówienia*.

Endpointy administracyjne:

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/organizations/:id/restrictions` | Odczyt trzech list i `version` organizacji |
| `PUT /api/v1/admin/organizations/:id/restrictions` | Atomowa zamiana wszystkich trzech |
| `PATCH .../restrictions/payment-methods` | Wybiórcza zmiana `{ add?, remove? }` |
| `PATCH .../restrictions/delivery-methods` | To samo |
| `PATCH .../restrictions/warehouses` | To samo |

Wstępne sprawdzenie w storefroncie:

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/storefront/checkout/preflight` | Zwraca `{ canTransact, allowedPaymentMethodIds, allowedDeliveryMethodIds, assignedWarehouseIds }` albo 423, gdy organizacja nie może składać zamówień |

### Cenniki obowiązujące organizację i promocje dla organizacji

Strona szczegółów organizacji w panelu administracyjnym pokazuje, tylko do odczytu, **cenniki, które
obecnie obowiązują organizację**: cenniki, których odbiorcy wskazują samą organizację, cenniki
wskazujące którąś z jej organizacji nadrzędnych (dziedziczone w hierarchii) oraz cenniki jej grupy
klientów. Każdy ma oznaczenie, jak dociera do organizacji — `direct_organization_match`,
`ancestor_organization_match` albo `customer_group_match` — a cenniki dla wszystkich nie są
wymieniane. O tym, który z nich wygrywa dla danego produktu, decyduje kolejność cen modułu
`price_lists`; odnośnik **Wyjaśnij cenę dla tej organizacji** na tej samej stronie otwiera dla niej
wyjaśnienie ceny.

Dla programistów: `OrganizationEffectivePriceListsService.listApplicable(orgId)` pyta moduł
`price_lists` przez `PriceListReadPort.listForOrganization({ organizationChain, customerGroupId })`
(kontener `priceListReadPort`), przekazując łańcuch organizacji od najbliższej oraz jej własną grupę
klientów. Odpowiedź jest dostępna pod `GET /api/v1/admin/organizations/:id/applicable-price-lists`.
Gdy modułu `price_lists` nie ma, wywołanie jest odrzucane, zamiast zwracać pustą listę. Powody
`sales_channel_inheritance` i `segment_rule_match` nie są już zwracane.

Promocje: gdy promocja jest skierowana do konkretnej organizacji (`promotions.organization_id` jest
ustawione), platforma stosuje ją tylko wtedy, gdy organizacja koszyka ma status `active`. Sprawdzenie
jest podłączone przez wymagany argument konstruktora `resolveOrganizationStatus` w
`PromotionService`, który moduł `promotions` podłącza do
`organizationReadPort.loadEffectiveOrganization`.

### Przypisanie handlowców

`organization_sales_rep_assignments` (tabela łącząca `(organization_id, admin_user_id)`) wiąże
handlowców z organizacjami. Gdy rola administratora wywołującego to `sales_representative`, listy
zamówień i zapytań ofertowych w panelu są ograniczane do organizacji przypisanych temu handlowcowi.
Administratorzy platformy widzą wszystko.

Tę relację obsługują trzy endpointy, należące do tego modułu i przez niego rejestrowane:

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/organizations/:id/sales-reps` | Lista handlowców przypisanych do organizacji. |
| `POST /api/v1/admin/organizations/:id/sales-reps` | Przypisanie handlowca. |
| `DELETE /api/v1/admin/organizations/:id/sales-reps/:adminUserId` | Usunięcie przypisania. |

Są chronione przez `organizations:assign-sales-rep`. Do 2026-08 rejestrował je moduł zapytań
ofertowych i chronił je `rfqs:handle`, co oznaczało, że wyłączenie zapytań ofertowych odbierało też
możliwość przypisywania handlowców — a kod chroniący ten ekran znikał z macierzy ról. Przypisanie
handlowca dotyczy organizacji, więc należy do tego modułu, z kodem, który ten moduł deklaruje. Po
stronie zapytań ofertowych pozostał jeden endpoint, listowanie w odwrotnym kierunku,
`GET /api/v1/admin/sales-reps/:adminUserId/organizations`: podaje, ile zapytań ofertowych jest
otwartych w każdej organizacji — a to fakt dotyczący tamtego modułu.

Inne moduły odczytują tę relację przez `organizationSalesRepScopePort` tego modułu, nigdy przez
bezpośrednie zapytanie do tabeli łączącej.

### Walidacja numeru VAT i NIP

Port `VatValidator` mają dwie produkcyjne implementacje klienta HTTP:

- `ViesClient` → `POST` na endpoint REST VIES (`/check-vat-number`). Limit czasu 5 s; jedno
  przerwanie przy błędzie sieci.
- `MinisterstwoFinansowClient` → `GET` na `wykazpodatnikowvat.mf.gov.pl/api/search/nip/{nip}`. Ograniczenie do
  10 żądań na sekundę w procesie; 7-dniowa pamięć podręczna z kluczem `(nip, today)`, oparta na
  historii w usłudze `OrganizationTaxIdValidation` (jeden wiersz na próbę).

`OrganizationTaxIdValidationService` sam wybiera dostawcę na podstawie przedrostka numeru (polski
10-cyfrowy → MF; inny dwuliterowy przedrostek ISO → VIES; pozostałe → tylko sprawdzenie formatu). Gdy
`applyAutoFill=true` ORAZ wynik to `validated`, `legalName` organizacji jest aktualizowane, a
`version` rośnie, aby następna edycja w panelu uwzględniała blokadę optymistyczną.

Wszystkie adaptery bezpiecznie obsługują awarię dostawcy: `outcome: 'deferred'`. Zapis organizacji
nigdy nie kończy się błędem z powodu problemu zewnętrznego.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/admin/organizations/:id/vat-validations` | Jedna próba walidacji (`providerHint`, `applyAutoFill`) |
| `GET /api/v1/admin/organizations/:id/vat-validations` | Historia, od najnowszych |

Każdy wpis historii mówi, skąd pochodzi: `origin: 'admin'` dla „Zweryfikuj teraz”, `'registration'` dla
danych z rejestru, które przyniosła samodzielna rejestracja (zobacz niżej). Wpis z rejestracji ma też
`registryDetails`, `submittedValues` i `divergence`; wpis administratora ma we wszystkich trzech `null`.
Kształt opisuje `organizationTaxIdValidationRecordSchema` w `@endora-commerce/contracts`.

### Pobieranie danych firmy z rejestru przy rejestracji

Firma rejestrująca się w sklepie może pobrać swoje dane z publicznego rejestru po numerze podatkowym,
a formularz rejestracji wypełnia się nimi. Każde uzupełnione pole można zmienić; dane mają charakter
wyłącznie informacyjny i żaden wynik wyszukiwania — brak w rejestrze, firma niebędąca czynnym
podatnikiem VAT, awaria rejestru — nie blokuje rejestracji. **Funkcja jest domyślnie wyłączona.**

**Rejestry i wybór rejestru.** Numer jest najpierw normalizowany (usuwane są spacje, myślniki i
kropki, rozpoznawany jest unijny przedrostek kraju, `GR` jest czytane jako `EL` z VIES), a suma
kontrolna polskiego NIP-u jest sprawdzana **zanim** zostanie odpytany jakikolwiek rejestr: błędny numer
albo kraj spoza UE nie powodują żadnego zapytania.

- **Polskie NIP-y** trafiają do rejestrów wybranych w ustawieniu *rejestry dla polskich NIP-ów*:
  - `gus_mf` (domyślnie) — **GUS REGON** (BIR1.1) i **Biała lista podatników VAT** Ministerstwa
    Finansów równolegle. GUS dostarcza pełną nazwę, REGON i uporządkowany adres; Biała lista — status
    VAT, a także dane, gdy GUS nie jest skonfigurowany, nie odpowiada albo nie zna numeru.
  - `gus` — wyłącznie GUS REGON. Biała lista nie jest odpytywana, więc jej dzienny limit zostaje dla
    „Zweryfikuj teraz”; status VAT jest pokazywany jako *niesprawdzony*. **Bez działających danych
    dostępowych GUS ustawienie `gus` oznacza, że dla polskich NIP-ów nie ma wyszukiwania wcale** — każde
    polskie wyszukiwanie odpowiada „rejestr niedostępny”. Wybierz je dopiero wtedy, gdy dane dostępowe
    GUS działają.
  - `mf` — wyłącznie Biała lista. Klucz GUS nie jest potrzebny, ale adres przychodzi jako jeden wiersz i
    jest dzielony na ulicę, kod pocztowy i miasto najlepiej, jak się da; czego nie da się podzielić,
    uzupełnia kupujący.
- **Pozostałe unijne numery VAT** zawsze trafiają do **VIES**, niezależnie od ustawienia dla Polski.
  Niektóre państwa (m.in. Niemcy) nie udostępniają nazwy ani adresu: kupujący dowiaduje się, że numer
  jest prawidłowy, i wpisuje dane sam.

**Ustawienia** (grupa *Organizations* na ekranie Ustawienia; otwiera go akcja palety poleceń
*Ustawienia pobierania danych firmy przy rejestracji*):

| Ustawienie | Wartość domyślna | Znaczenie |
| --- | --- | --- |
| `organizations.registration.registry_lookup_enabled` | `false` | Włącza wyszukiwanie. Po wyłączeniu sklep pokazuje formularz do ręcznego wypełnienia, a `POST /api/v1/organizations/registry-lookup` odpowiada dokładnie tak jak nieistniejąca ścieżka. Działa bez restartu. |
| `organizations.registration.registry_lookup_pl_sources` | `gus_mf` | `gus_mf` \| `gus` \| `mf`, jak wyżej. Odczytywane przy każdym wyszukiwaniu; nieczytelna wartość liczy się jako `gus_mf`. Ekran Ustawienia ostrzega obok niego, gdy wybrano `gus`, a nie wybrano danych dostępowych GUS. |
| `organizations.registration.gus_credentials` | puste | Dane dostępowe GUS REGON używane przez wyszukiwanie. Opcjonalne przy `gus_mf` i `mf`. |

**Dane dostępowe GUS.** Utwórz je na ekranie **Dane dostępowe** z typem *GUS REGON registry (BIR1.1)*:
**klucz użytkownika** wydany przez GUS (tajny — przechowywany w postaci zaszyfrowanej, pokazywany
zamaskowany, nigdy nie zwracany w całości) oraz **środowisko**, *Production* albo *Test*. Zmiana
środowiska wymaga ponownego podania klucza. Aby wypróbować wyszukiwanie bez klucza produkcyjnego,
użyj środowiska *Test* z publicznym kluczem testowym GUS `abcde12345abcde12345`; rejestr testowy
zawiera dane zanonimizowane. Następnie wskaż te dane dostępowe w
`organizations.registration.gus_credentials`. Gdy moduł `credentials` jest wyłączony, gdy danych
dostępowych nie da się odczytać albo gdy GUS odrzuci klucz, polskie wyszukiwania działają tak jak bez
danych dostępowych.

Klient GUS korzysta z wbudowanego w Node magazynu certyfikatów, który akceptuje serwery GUS i VIES;
wdrożenie, które go zastępuje (`--use-openssl-ca`, własny pakiet urzędów certyfikacji), musi zadbać o to,
by nadal im ufało.

**Limity i pamięć podręczna.** Wyszukiwanie nie jest otwartym pośrednikiem do rejestrów:

- **Na klienta:** 10 wyszukiwań na 10 minut z jednego adresu (powyżej `429 RATE_LIMITED`). Sklep
  przekazuje `X-Forwarded-For` kupującego, więc limit liczy kupującego tylko tam, gdzie backend ufa
  sklepowi jako pośrednikowi (`TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_ADDRESSES`); bez tego wszyscy
  kupujący sklepu renderowanego po stronie serwera dzielą jeden limit.
- **Na rejestr, dla całej platformy:** GUS i VIES — 300 zapytań na godzinę (UTC); Biała lista — 60 na
  dobę według czasu warszawskiego, co zostawia resztę jej dziennego limitu na adres IP (100 zapytań
  `search`) dla „Zweryfikuj teraz”. Po wyczerpaniu limitu rejestr jest traktowany jako niedostępny;
  rejestr wyłączony ustawieniem dla Polski nie zużywa limitu wcale.
- **Pamięć podręczna:** odpowiedzi są zapamiętywane według kraju, wyboru rejestrów dla Polski i numeru
  — znalezione na 6 godzin, nieznalezione na 30 minut, niedostępne na 60 sekund — więc powtórne
  wyszukiwanie nie odpytuje rejestru, a zmiana wyboru rejestrów nigdy nie zwraca odpowiedzi pobranej
  przy poprzednim wyborze.
- **Czas:** wyszukiwanie odpowiada w ciągu 8 sekund, niezależnie od rejestrów.
- **Redis:** pamięć podręczna, limity i identyfikatory wyszukiwań są przechowywane w Redisie. Gdy Redis
  zawodzi, wyszukiwanie odpowiada „rejestr niedostępny” zamiast działać bez limitów; rejestracja działa
  normalnie.

Odpowiedź nigdy nie zdradza, czy dany numer należy już do organizacji na tej platformie; rejestracja
odrzuca duplikat istniejącym kodem 409.

**Co widzą moderatorzy.** Rejestracja poprzedzona wyszukiwaniem zapisuje jeden wpis w historii
walidacji VAT, oznaczony jako *Rejestracja*, z odpowiedzią rejestru (źródło, pełna nazwa, adres, REGON,
status VAT i działalności, obowiązujący wybór rejestrów dla Polski, rejestry, które zawiodły albo nie
zostały odpytane) i danymi wpisanymi przez klienta. Panel pokazuje kartę *Dane z rejestru przy
rejestracji* z jednym i drugim obok siebie i oznacza każde pole, które **się różni**; różnice wyłącznie
w wielkości liter, znakach diakrytycznych, odstępach, interpunkcji albo popularnym zapisie formy
prawnej (`sp. z o.o.`, `S.A.` …) się nie liczą. Organizacja oczekująca na weryfikację, której dane się
różnią, pokazuje komunikat w akcjach moderacji. Pola samej organizacji zawierają to, co wpisał klient —
pełną nazwę z rejestru można przejąć wyłącznie przez „Zweryfikuj i uzupełnij pełną nazwę”.

**Bez JavaScriptu.** Przycisk *Pobierz dane firmy* wysyła formularz na serwer, a strona wraca z
uzupełnionymi polami firmy i wszystkim innym, co wpisał kupujący — poza hasłem, które nigdy nie jest
odsyłane — bez żadnych danych w pasku adresu. Naciśnięcie Enter w polu poniżej NIP-u pobiera wtedy dane
zamiast rejestrować; z JavaScriptem Enter pobiera dane tylko w polu NIP.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/organizations/registration-options` | Czy wyszukiwanie jest włączone i dla których krajów (sklep zapamiętuje odpowiedź do 5 minut i odświeża ją po zmianie ustawienia) |
| `POST /api/v1/organizations/registry-lookup` | Jedno wyszukiwanie (`{ taxId, country }`); odpowiada `found`, `not_found`, `unavailable`, `invalid_tax_id` albo `unsupported_country` wraz z `lookupId` |
| `POST /api/v1/organizations/register` | Przyjmuje opcjonalne `registryLookupId` na najwyższym poziomie; dane z rejestru są odczytywane z magazynu platformy, nigdy z żądania |

### Lista wyboru i wyszukiwanie bez polskich znaków

Panel dostarcza komponenty wielokrotnego użytku `<OrganizationPicker>` (wybór jednej organizacji) i
`<OrganizationPickerMulti>` (wybór wielu), zbudowane na istniejącym `<Combobox>`. Korzystają z
`GET /api/v1/admin/organizations?q=`, gdzie parametr `q` nie wymaga znaków diakrytycznych: zapytanie
`lodz` znajduje „Bauhaus Łódź” dzięki zdenormalizowanej kolumnie `name_search`, wypełnianej przez hooki
`@BeforeCreate` / `@BeforeUpdate` encji Organization. `normalizeOrganizationName` to usunięcie
diakrytyków i reguły dotyczące odstępów, których wymaga ta kolumna. Samo usuwanie diakrytyków to
`foldDiacritics` (`packages/contracts/src/text-normalization.ts`), wspólne z panelem: rozkład NFD,
usunięcie znaków łączących, a potem jawna tabela dla liter łacińskich, których NFD nie rozkłada
(`ł`/`Ł`, `ø`/`Ø`, `đ`/`Đ`, `ð`/`Ð`, `þ`/`Þ`, `ß`, `æ`, `œ`). Zmiana tej tabeli sprawi, że nowe
wiersze będą przekształcane inaczej niż stare, więc wymaga migracji `name_search`, a nie zwykłej
edycji.

### Nowe ustawienia (zadeklarowane w manifeście)

| Kod | Typ | Wartość domyślna | Przeznaczenie |
| --- | --- | --- | --- |
| `organizations.moderation.mode` | wyliczenie `string` | `'manual'` | `manual` ⇒ pending_verification; `auto` ⇒ active od razu po rejestracji |
| `organizations.notifications.new_registration_recipients` | tablica `json` | `[]` | Adresy e-mail powiadamiane o nowej organizacji |
| `organizations.registration.registry_lookup_enabled` | `boolean` | `false` | Pobieranie danych firmy z rejestru przy rejestracji (zobacz wyżej) |
| `organizations.registration.registry_lookup_pl_sources` | wyliczenie `string` | `'gus_mf'` | Rejestry odpytywane o polski NIP: `gus_mf` \| `gus` \| `mf` |
| `organizations.registration.gus_credentials` | `credential_ref` | `''` | Dane dostępowe GUS REGON (typ `organizations_gus_bir`) |

### Migracje

- `20260611T140349_organizations_consolidation.ts` — dodaje `legal_name`, kolumny walidacji VAT, kolumny audytu
  blokady, odrzucenia i zatwierdzenia, `version` do blokady optymistycznej, zdenormalizowaną kolumnę
  `name_search`, trzy tabele list dozwolonych, tabelę historii walidacji, indeks B-Tree
  `organizations_name_search_idx` i zamienia każdy wiersz `suspended` na `blocked`.
- `20260611T140350_admin_notifications_init.ts` (należy do `admin_notifications`) — dodaje tabelę `admin_notifications` i tabelę łączącą
  `admin_notification_reads` dla każdego administratora.
- `20260611T140351_customer_accounts_organization_optional.ts` (należy do `customer_accounts`) — dopuściła `NULL` w
  `customer_accounts.organization_id` dla kont gościnnych. **To rozwiązanie jest martwe**: zastąpiły
  je organizacje prywatne, a kolumnę ponownie zaostrzono — zobacz
  `20260825T141659_customer_accounts_organization_required` w `customer_accounts`.
- `20260717T151403_organizations_personal_organizations.ts` — dodaje `organizations.is_personal` i tworzy organizację prywatną
  dla każdego wcześniej istniejącego konta bez organizacji (zobacz „Organizacje prywatne” niżej).
- `20261103T173304_organizations_organization_roles.ts` — tworzy `organization_roles`, daje każdej organizacji role
  Administrator i Członek (oraz wyzwalacz, który robi to dla każdej nowej), odbiera roli Członek dwa kody akceptacji
  koszyka tam, gdzie organizacja wymagała akceptacji koszyków, i daje każdemu zaproszeniu odwołanie do roli (zobacz
  „Role” niżej).
- `20261105T121034_organizations_registry_lookup_provenance.ts` — dodaje do `organization_tax_id_validations`
  kolumny `origin` (`admin` dla każdego istniejącego wiersza), `registry_details` i `submitted_values` oraz dopuszcza
  dostawcę `gus_pl` (zobacz „Pobieranie danych firmy z rejestru przy rejestracji” wyżej).

### Organizacje prywatne (B2C)

Organizacja jest jedynym pojęciem tenanta w platformie. Klient B2C, czyli osoba fizyczna, **nie** jest
przypadkiem „bez organizacji”: każda samodzielna rejestracja klienta tworzy jednoosobową
**organizację prywatną** (`is_personal = true`). Organizacja i konto są zapisywane **w jednej
transakcji**, przez moduł, który jest właścicielem wiersza konta, na obu ścieżkach tworzenia konta —
przy samodzielnej rejestracji i przy logowaniu przez zewnętrznego dostawcę tożsamości. Oznacza to, że:

- **Transakcje działają bez zmian.** `organization_id` ma `NOT NULL`, więc zamówienia, zapytania
  ofertowe, limity kredytowe, faktury i adresy nie potrzebują ścieżki „bez organizacji” — a odmowę
  zapewnia kolumna, a nie zabezpieczenie w kodzie: MikroORM stosuje filtr tenanta do `SELECT` /
  `UPDATE` / `DELETE`, ale nie do `INSERT`.
- **Izolacja wynika ze struktury.** Zabezpieczenie izolacji tenantów traktuje każdą organizację
  prywatną jako osobnego tenanta — dwóch klientów B2C nigdy nie widzi swoich danych, bez żadnego
  szczególnego przypadku dla braku organizacji.
- **Wartości domyślne dla osób fizycznych.** `status = active`, `vat_status = vat_exempt`, `name` z
  imienia i nazwiska klienta (albo z części adresu e-mail przed `@`) oraz syntetyczny 32-znakowy
  szesnastkowy `tax_id` utworzony z identyfikatora konta (kolumna ma globalne `UNIQUE`, a osoba
  fizyczna nie ma firmowego NIP).
- **Niewidoczne na ekranach B2B w panelu.** Organizacje prywatne są domyślnie pomijane na listach i
  listach wyboru w panelu, nie można przypisać do nich handlowca i nie trafiają do kolejki moderacji
  (powstają jako `active`). Lista organizacji w panelu przyjmuje `?includePersonal=true`, aby je w
  razie potrzeby pokazać.
- **Dostępność zależna od kanału.** Samodzielną rejestrację (B2C) w każdym kanale sprzedaży włącza
  ustawienie `customers.allow_registration_without_organization`; kanał tylko dla B2B odrzuca
  rejestrację i niczego nie tworzy. Nazwa ustawienia to pozostałość po wcześniejszym rozwiązaniu —
  dotyczy rejestracji poza organizacją *firmową*, a nie rejestracji bez organizacji.
- **Odłączenie członka od firmy przenosi go tutaj.** `DELETE /api/v1/admin/customers/:id/organization`
  w panelu zapisywało kiedyś `organization_id = NULL`; teraz tworzy (albo odnajduje) organizację
  prywatną klienta i przenosi go do niej, zachowując w audycie akcję
  `customer_account.organization_unassigned`.

Organizacje firmowe (B2B) pozostają bez zmian — reguła jednoosobowości (`assertMembershipAllowed`)
odrzuca tylko dodanie drugiego członka do organizacji prywatnej.

## Role

Każda organizacja ma role, a każdy członek ma dokładnie jedną z nich. Rola to
zestaw **uprawnień organizacji** — działań kupującego, takich jak *tworzenie
koszyków* czy *akceptowanie koszyków* — z których każde deklaruje moduł, którego
działanie ono chroni, w swoim manifeście (`organizationPermissions`). Uprawnienia
organizacji to inny słownik niż uprawnienia operatora z `/admin-roles`
(`<moduł>.<działanie>` wobec `<obszar>:<działanie>`) i te dwa słowniki nigdy się
nie mieszają.

- **Administrator** — rola predefiniowana. Ma wszystkie uprawnienia wszystkich
  włączonych modułów, także uprawnienia dodane później, i jako jedyna może
  zarządzać członkami, zaproszeniami i rolami. Nie można jej edytować ani usunąć.
- **Członek** — rola predefiniowana. Domyślna rola nowego członka. Jej
  uprawnienia można zmieniać, ale nie można jej przemianować ani usunąć.
  Uprawnienie, które moduł deklaruje jako *domyślne dla członka*, rola Członek
  ma od chwili, gdy ten moduł zostanie po raz pierwszy zaoferowany organizacji;
  gdy administrator zapisze rolę Członek bez niego, nie zostanie ono nadane
  ponownie.
- **Role własne** — do 50 w organizacji, każda z nazwą niepowtarzalną w obrębie
  organizacji (porównywaną bez względu na wielkość liter i nigdy równą nazwie
  roli predefiniowanej w żadnym z dostarczanych języków) i opcjonalnym opisem.

Obie role predefiniowane powstają razem z organizacją, niezależnie od tego,
która ścieżka ją tworzy (wyzwalacz w bazie danych). Organizacja prywatna (B2C)
także ma obie role, ale nie ma zarządzania rolami: jej jedyny członek jest jej
Administratorem.

Uprawnienia modułu, który jest wyłączony, nie ma nikt i nie pokazuje go edytor;
rola, która je nadawała, zachowuje to nadanie, więc ponowne włączenie modułu je
przywraca. Zmiany ról obowiązują od następnego żądania: każdy proces przechowuje
role organizacji w pamięci najwyżej 30 sekund i usuwa wpis, gdy tylko którykolwiek
proces ogłosi zmianę.

Każda zmiana roli to Komenda — `organization_role.create`,
`organization_role.update`, `organization_role.delete` — audytowana na
organizacji, ze wskazaniem członka lub operatora, który jej dokonał, oraz z
nazwą, rodzajem i posortowaną listą uprawnień roli przed zmianą i po niej.
Zapisanie roli bez zmian niczego nie rejestruje.

| Metoda + ścieżka | Kto | Cel |
| --- | --- | --- |
| `GET /api/v1/organizations/mine/roles` | administrator organizacji | Wszystkie role z liczbą członków i oczekujących zaproszeń (oczekujące: nieprzyjęte, nieanulowane i niewygasłe) |
| `GET /api/v1/organizations/mine/roles/:id` | administrator organizacji | Jedna rola |
| `POST /api/v1/organizations/mine/roles` | administrator organizacji | Utworzenie roli własnej (`{ name, description?, permissions }`) |
| `PATCH /api/v1/organizations/mine/roles/:id` | administrator organizacji | Edycja roli (`{ expectedVersion, name?, description?, permissions? }`) |
| `DELETE /api/v1/organizations/mine/roles/:id` | administrator organizacji | Usunięcie roli własnej (`{ expectedVersion, replacementRoleId? }`) |
| `GET /api/v1/organizations/mine/permission-catalogue` | administrator organizacji | Dostępne uprawnienia pogrupowane według modułów, w języku żądania |
| `GET /api/v1/organizations/mine/role` | klient | Własna rola członka i to, na co pozwala |
| `GET /api/v1/admin/organizations/:id/roles` | admin (`organizations:read-roles` lub `organizations:manage-roles`) | Jak lista w sklepie |
| `GET /api/v1/admin/organizations/:id/permission-catalogue` | admin (`organizations:read-roles` lub `organizations:manage-roles`) | Jak katalog w sklepie |
| `POST /api/v1/admin/organizations/:id/roles` | admin (`organizations:manage-roles`) | Utworzenie roli własnej |
| `PATCH /api/v1/admin/organizations/:id/roles/:roleId` | admin (`organizations:manage-roles`) | Edycja roli |
| `DELETE /api/v1/admin/organizations/:id/roles/:roleId` | admin (`organizations:manage-roles`) | Usunięcie roli własnej |

Każde ciało żądania jest ścisłe: ciało, które wciąż wysyła dawne pole `role`, jest
odrzucane z `400 VALIDATION_FAILED`. Rola innej organizacji oraz każda ścieżka ról
organizacji prywatnej odpowiada `404`. Odmowy to
`409 ORGANIZATION_ROLE_NAME_TAKEN`, `409 ORGANIZATION_ROLE_STALE` (rola zmieniła
się od chwili odczytu), `422 ORGANIZATION_ROLE_LIMIT_REACHED`,
`409 ORGANIZATION_ROLE_PROTECTED`, `422 ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`
i `422 ORGANIZATION_PERMISSION_UNKNOWN`. Działanie kupującego odrzucone z powodu
braku uprawnienia odpowiada `403 ORGANIZATION_PERMISSION_REQUIRED`, z kodem
uprawnienia i jego etykietą w `details`.

Inne moduły pytają, czy członek może coś zrobić, przez
`organizationPermissionPort` (`can`, `assert`, `isAdministrator`, `effective`,
`rolesHolding`) i chronią swoje ścieżki funkcją `organizationPermissionPreHandler`
z `@endora-commerce/contracts`. `organizationRoleReadPort.predefinedRoleId` podaje
identyfikator roli Administrator lub Członek organizacji.

### Role w storefroncie

Administratorzy organizacji zarządzają rolami w obszarze konta. To, co widzi każdy członek, zależy
od jego roli i od rodzaju organizacji:

- **Nawigacja konta.** *Członkowie* i *Role* są widoczne dla członków z rolą *Administrator*;
  *Koszyki do akceptacji* — dla członków, których rola ma uprawnienie *Akceptowanie i odrzucanie
  koszyków współpracowników* (`carts.approve`), z liczbą oczekujących koszyków. Członek
  organizacji prywatnej (B2C) nie widzi żadnej z tych trzech pozycji, choć ma rolę
  *Administrator*, a te strony odsyłają go do `/account`. Organizacja prywatna nie jest firmą,
  więc taki członek nie widzi też pozycji *Organizacja* ani *Adresy organizacji*: `/organization`
  odsyła go do `/account`, a `/organization/addresses` do jego własnej książki adresowej,
  `/addresses`, na której adresy organizacji nadal są widoczne obok jego własnych. Profil nie ma
  dla niego wiersza *Organizacja*, a pole NIP w danych firmy do rozliczenia przy składaniu
  zamówienia jest puste zamiast wypełnione syntetycznym NIP-em organizacji prywatnej. Każdy inny, kto otworzy taką stronę,
  dowiaduje się, kto może z niej korzystać — na przykład *„Rolami mogą zarządzać tylko
  administratorzy organizacji.”*
- **Role** (`/organization/roles`) to lista wszystkich ról z rodzajem (*Wbudowana* albo
  *Własna*), liczbą członków, oczekujących zaproszeń i uprawnieniami, oraz przycisk **Nowa
  rola**. Każda rola otwiera się na własnej stronie (`/organization/roles/<id>`): *Administrator*
  jest pokazany jako rola ze wszystkimi uprawnieniami i nie można go zmienić; *Członek* zachowuje
  nazwę i przyjmuje tylko zmiany uprawnień; rolę własną można przemianować, opisać, edytować i
  usunąć. Usunięcie roli, którą mają członkowie lub oczekujące zaproszenia, wymaga wskazania
  roli, do której zostaną przeniesieni; usunięcia nie można cofnąć.
- **Nowa rola zaczyna bez żadnych uprawnień.** Strona tworzenia (`/organization/roles/new`)
  otwiera się z odznaczonymi wszystkimi uprawnieniami i nie proponuje „skopiuj z innej roli”;
  rola utworzona bez zaznaczeń na nic nie pozwala. Uprawnienia są pogrupowane według modułów, z
  etykietą i opisem w języku strony, a przy *Zakupie jednym kliknięciem* widnieje uwaga, że działa
  on tylko razem z uprawnieniem *Składanie zamówień bez akceptacji*.
- **Dwóch administratorów edytuje tę samą rolę.** Drugi zapis jest odrzucany; strona zachowuje
  wpisane dane i proponuje wczytanie aktualnego stanu roli.
- **Członkowie** (`/organization/members`) pokazuje rolę każdego członka jako listę wyboru ról
  organizacji, a formularz zaproszenia wskazuje rolę nowego członka, z domyślnie wybraną rolą
  *Członek*.
- **Strona konta** pokazuje członkowi jego rolę i zrozumiałą listę tego, na co ona pozwala (*Na
  co pozwala Twoja rola*), przetłumaczoną przez API; rola, która na nic nie pozwala, mówi o tym
  wprost. Członek organizacji prywatnej nie widzi ani roli, ani listy.

### Role w panelu administracyjnym

Ekran szczegółów organizacji ma zakładkę **Role**. Widzi ją operator z uprawnieniem
`organizations:read-roles` lub `organizations:manage-roles`, i nigdy dla organizacji prywatnej.
Z uprawnieniem do odczytu zakładka jest tylko do odczytu; z `organizations:manage-roles` operator
tworzy, edytuje i usuwa role według tych samych reguł co w storefroncie — formularz tworzenia
również otwiera się z odznaczonymi wszystkimi uprawnieniami, a rolę, którą ktoś ma, można usunąć
tylko ze wskazaniem roli zastępczej. Tabela członków na tym samym ekranie pokazuje rolę każdego
członka, a operatorowi z `customers:manage` — listę wyboru roli. Zakładka prowadzi do historii
organizacji w dzienniku audytu, gdzie zapisana jest każda zmiana roli.

### Członkowie, zaproszenia i sesja

Rola członka jest wskazywana przez swój identyfikator wszędzie, gdzie żądanie ją
podaje, i pokazywana jako `organizationRole: { id, name, kind }` wszędzie, gdzie
odpowiedź ją pokazuje — w odpowiedzi logowania, `GET /api/v1/me`,
`GET /api/v1/me/customer`, przyjęciu zaproszenia, listach członków i zaproszeń,
liście członków w panelu operatora i odpowiedzi rozpoczęcia impersonacji. `name`
roli predefiniowanej jest tłumaczone na język odpowiedzi; rola własna ma swoją
nazwę. Widoki sesji (logowanie, `GET /api/v1/me`, `GET /api/v1/me/customer`,
przyjęcie zaproszenia) zawierają też `permissions` — kody uprawnień, które członek
faktycznie ma — aby sklep mógł ukryć to, czego członek nie może zrobić. Żadne
żądanie ani odpowiedź nie zawiera już dawnego pola `role`
(`organization_admin` / `regular_user`).

- **Zastrzeżone dla Administratora.** Zarządzanie członkami (lista, zmiana ról,
  usuwanie), zaproszeniami i rolami oraz ustawianie zasad uwierzytelniania
  dwuskładnikowego organizacji są zastrzeżone dla roli Administrator. Rola
  własna mająca wszystkie uprawnienia wciąż otrzymuje odmowę.
- **Ostatni administrator.** Przeniesienie ostatniego aktywnego Administratora do
  innej roli jest odrzucane z `409 CANNOT_DEMOTE_LAST_ADMIN`, jego usunięcie
  z `409 CANNOT_REMOVE_LAST_ADMIN`, a unieważnienie jedynego oczekującego
  zaproszenia z rolą Administrator w organizacji bez aktywnego Administratora
  z `409 CANNOT_REVOKE_LAST_ADMIN_INVITE`; wygasłe zaproszenie nie jest
  oczekujące. Zablokowani administratorzy się nie
  liczą.
- **Zaproszenia.** Zaproszenie wskazuje rolę organizacji — rolę Członek, gdy
  żądanie nie wskazuje żadnej; rola innej organizacji daje `404`. E-mail
  z zaproszeniem pokazuje etykietę roli w języku e-maila (rola własna — swoją
  nazwę). Lista oczekujących pomija zaproszenia przyjęte, unieważnione
  i wygasłe.
- **Adresy.** Tworzenie, edycja i usuwanie wspólnych adresów organizacji wymaga
  uprawnienia `addresses.manage` (deklarowanego przez `addresses`, domyślnie
  w roli Członek); ich odczyt — nie.
- **Organizacje prywatne.** Jedyny członek organizacji prywatnej ma jej rolę
  Administrator. Trasy członków i zaproszeń odpowiadają mu jak każdemu
  administratorowi (lista członków zawiera tylko jego, lista zaproszeń jest
  pusta); zaproszenie jest odrzucane z `422 VALIDATION_FAILED`, bo organizacja
  jest prywatna, zanim rola zostanie sprawdzona. Sklep ukrywa tam ekrany
  organizacji na podstawie `organization.isPersonal`, nigdy roli.
- **Logowanie i koszyk gościa.** Gdy loguje się członek, którego rola nie ma
  uprawnienia *Tworzenie i edycja koszyków*, jego koszyk gościa nie jest łączony:
  logowanie odpowiada `cartMerge.outcome = 'noop'` i zachowuje ciasteczko
  `b2b_cart_anon`, więc koszyk gościa wciąż istnieje.

Przypisanie roli, usunięcie członka i awaryjne nadanie roli Administrator
uruchamiają polecenia `customer_account.change_role` /
`customer_account.remove_member` modułu `customer_accounts`; utworzenie
i unieważnienie zaproszenia — `organization_invitation.create` /
`organization_invitation.revoke`. Każde jest audytowane względem organizacji,
z członkiem lub operatorem, który działał.

## Wyszukiwanie globalne

Wyszukiwanie globalne w panelu administracyjnym (paleta poleceń, ⌘K / Ctrl+K) znajduje organizacje. Ten moduł udostępnia poniższe pola; to, które z nich są używane, wybiera się na ekranie konfiguracji wyszukiwania globalnego.

| Pole | Przeszukiwane domyślnie |
| --- | --- |
| Nazwa | tak |
| NIP | tak |
| Nazwa prawna | nie |

Nazwy są dopasowywane bez względu na polskie znaki diakrytyczne, więc `lodz` znajduje *Łódź*. Wynikami są organizacje, które administratorowi pokazuje lista organizacji — organizacje firmowe, które nie zostały usunięte — dla roli z uprawnieniem `customers:read` lub `customers:manage`. Przedstawicielowi handlowemu przypisane mu organizacje są pokazywane jako pierwsze, a pozostałe po nich.

---
title: Konta klientów
description: Logowanie klientów, reset hasła, weryfikacja dwuetapowa, przypisanie roli
---

# Konta klientów (`customer_accounts`)

Dane każdego użytkownika po stronie klienta: logowanie, zarządzanie hasłem, opcjonalna weryfikacja dwuetapowa i rola
w organizacji. Moduł korzysta ze wspólnej usługi sesji z `auth`; odpowiada za tożsamość użytkowników
po stronie klienta.

## API publiczne

Trasy logowania, hasła i resetu obsługuje moduł `organizations`, korzystając z usług tego
modułu.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/auth/customer/login` | E-mail i hasło. Gdy wymagany jest drugi składnik, odpowiada `mfaRequired` (z `challengeId`) lub `mfaSetupRequired` (z `setupTicket`) i nie ustawia sesji; drugi krok to `POST /api/v1/auth/customer/mfa/verify` modułu `mfa` |
| `POST /api/v1/auth/customer/logout` | Zakończenie sesji |
| `POST /api/v1/me/password` | Zmiana hasła (odrzuca błędne `currentPassword`). Udana zmiana wylogowuje konto ze wszystkich pozostałych sesji (sesja, z której wysłano żądanie, zostaje), unieważnia niewykorzystane tokeny resetu hasła i wycofuje każde rozpoczęte, a niedokończone logowanie. |
| `POST /api/v1/auth/password-reset/request` | Rozpoczęcie resetu hasła. Nowy link unieważnia wszystkie wcześniejsze niewykorzystane, więc działa tylko ten z najnowszej wiadomości. Powtarzane żądania dla jednego adresu są ograniczane (zob. niżej) |
| `POST /api/v1/auth/password-reset/confirm` | Użycie tokenu resetu hasła. Wykorzystanie tokenu wylogowuje konto ze **wszystkich** sesji, unieważnia pozostałe niewykorzystane tokeny resetu i wycofuje każde rozpoczęte, a niedokończone logowanie. |
| `GET /api/v1/admin/customer-groups` | Panel: lista grup klientów (`customer_groups:read`) |
| `PUT /api/v1/admin/customer-groups/:code` | Panel: utworzenie lub aktualizacja grupy o tym kodzie — `name`, opcjonalnie `description` (`customer_groups:write`) |
| `DELETE /api/v1/admin/customer-groups/:id` | Panel: usunięcie grupy klientów, `204` (`customer_groups:write`) |

## Ograniczanie powtarzanych prób

Powtarzane błędne hasła, błędne kody drugiego składnika oraz powtarzane żądania
resetu hasła dla jednego konta klienta otrzymują odpowiedź **429
`CUSTOMER_AUTHENTICATION_THROTTLED`** — z nagłówkiem `Retry-After` i tą samą
liczbą sekund w `error.details.retryAfterSeconds` — dopóki nie upłynie czas
wstrzymania. W czasie wstrzymania odrzucane jest także poprawne hasło, bez
sprawdzania. Adres, który nie należy do żadnego konta, jest ograniczany tak samo
jak adres konta, więc odpowiedź nie zdradza, które adresy mają konta.

| Co jest liczone | Przed wstrzymaniem | Liczone przez |
| --- | --- | --- |
| Błędne hasła dla jednego konta z urządzeń, na których nigdy się na nie nie logowano | 50 | 30 minut od pierwszego |
| Błędne kody drugiego składnika dla jednego konta z takich urządzeń | 20 | 30 minut od pierwszego |
| Żądania resetu hasła dla jednego adresu z takich urządzeń | 5 | 1 godzinę od pierwszego |
| Każde z powyższych z jednego znanego urządzenia | 10 | 30 minut od pierwszego |

Pierwsze wstrzymanie trwa minutę (piętnaście minut dla żądań resetu), a każda
kolejna nieudana próba podwaja je, najwyżej do piętnastu minut (godziny dla
żądań resetu). Udane logowanie zeruje licznik.

**Znane urządzenia.** Ukończone logowanie — hasło oraz, jeśli jest wymagany,
drugi składnik — zostawia na urządzeniu podpisany plik cookie `httpOnly`
`b2b_customer_device`, ważny 90 dni. Nie jest sesją i nie daje żadnego dostępu;
próba, która go niesie, jest liczona w limicie tego urządzenia, a nie całego
konta, więc ktoś, kto zna adres e-mail klienta, nie odetnie go od urządzenia,
na którym już się logował. Plik cookie przestaje być honorowany po zmianie hasła
oraz dopóki konto jest zablokowane lub usunięte.

**Bez liczenia według adresu.** Sklep loguje klientów ze swojego serwera, więc
każda próba dociera do backendu z tego samego adresu; liczenie według adresu
pozwoliłoby jednemu klientowi zablokować wszystkich pozostałych. Sklep przekazuje
plik cookie `b2b_customer_device` przeglądarki przy logowaniu, w drugim kroku i
przy żądaniu resetu, a zapisuje ten, który ustawia backend.

Gdy dla istniejącego konta rozpoczyna się wstrzymanie, zapisywany jest jeden
wpis dziennika audytu `customer_account.authentication_throttled`. Jeśli Redis
nie odpowie w ciągu trzech sekund, próba jest odrzucana z **503
`CUSTOMER_AUTHENTICATION_UNAVAILABLE`**.

## Role w organizacji

Każde konto ma dokładnie jedną **rolę w organizacji**, rolę własnej
Organizacji: *Administrator*, *Członek* albo rolę niestandardową zdefiniowaną
przez administratorów Organizacji (same role, ich uprawnienia i trasy należą do
modułu `organizations`). Przypisanie pilnuje baza danych: konto nie może
wskazywać roli innej Organizacji, a roli, którą ma jeszcze jakiekolwiek konto —
także zablokowane lub usunięte — nie da się usunąć.

- **Nowe konta.** Osoba rejestrująca firmę jest jej *Administratorem*. Klient
  indywidualny (B2C) jest *Administratorem* własnej, osobistej Organizacji — po
  samodzielnej rejestracji i po pierwszym logowaniu przez zewnętrznego dostawcę
  tożsamości. Zaproszony członek otrzymuje rolę wskazaną w zaproszeniu.
- **Przeniesienie konta.** Gdy operator przypisuje klienta do innej firmy,
  klient zostaje jej *Administratorem*, jeśli administrował firmą, z której
  przychodzi, a w przeciwnym razie jej *Członkiem*; rola niestandardowa nie
  przechodzi. Klient przenoszony z własnej osobistej Organizacji zostaje
  *Członkiem*. Odłączenie klienta od firmy przywraca go jako *Administratora*
  jego osobistej Organizacji.
- **Ostatni administrator.** Organizacja zachowuje co najmniej jednego
  aktywnego administratora: degradacja lub usunięcie ostatniego jest odrzucane
  z **409 `CANNOT_DEMOTE_LAST_ADMIN`** / **409 `CANNOT_REMOVE_LAST_ADMIN`**.
  Zablokowany administrator się nie liczy. Gdy dwóch administratorów w tej
  samej chwili rezygnuje z tej roli, uda się to tylko jednemu.
- **Następne żądanie.** Sesja odczytuje konto przy każdym żądaniu, więc zmiana
  roli obowiązuje od najbliższego żądania członka, na każdym serwerze.

Zmiany ról są poleceniami (Commands), a każde jest zapisywane w dzienniku
audytu przy Organizacji:

| Akcja | Kiedy |
| --- | --- |
| `customer_account.change_role` | Konto przechodzi do innej roli — także raz na członka, gdy usuwana jest rola, którą ma, a jej członkowie przechodzą do roli zastępczej |
| `customer_account.remove_member` | Członek zostaje usunięty z Organizacji |
| `customer_account.promote_organization_admin` | Operator przywraca dostęp Organizacji, która została bez administratora |

Po zatwierdzeniu zmiany roli ogłaszane jest też zdarzenie
`customer_account.organization_role_changed.v1`.

### Tworzenie konta z innego modułu

`customer_account.create` ma jedną implementację, udostępnioną na dwa sposoby:

- `customerAccountMemberWritePort.create(input)` tworzy konto we własnej
  transakcji — korzystają z tego bezpośrednie dodanie członka i przyjęcie
  zaproszenia;
- `customerAccountMemberCommandPort.prepareCreate(input)` haszuje hasło
  i zwraca obiekt budujący; `.command({ organizationId, organizationRoleId })`
  to polecenie, które wywołujący uruchamia jako polecenie **podrzędne** swojego
  polecenia przez `ctx.run`, więc konto zostaje zatwierdzone albo wycofane razem
  z zapisem wywołującego. Korzysta z tego samodzielna rejestracja w module
  `organizations`. Przygotuj je, zanim uruchomisz własne polecenie: haszowanie
  jest celowo wolne i nie może odbywać się wewnątrz transakcji.

Oba odrzucają adres, który jest już zarejestrowany, kodem **409
`EMAIL_ALREADY_REGISTERED`** — ze wstępnego sprawdzenia i z unikalnego indeksu.

### Co zawiera dziennik audytu

Dziennik audytu platformy czyta każdy, kto ma `audit_log:read`, bez względu na
to, które organizacje widzi, dlatego wpisy konta zawierają nazwy i strukturę,
nigdy jego wartości:

- zmiana profilu (`customer_account.update_profile`) wymienia zmienione pola
  jako `changedFields`, bez adresu e-mail i bez imienia i nazwiska;
- utworzenie konta (`customer_account.create`, `.register_standalone`,
  `.register_social`) wymienia pola, z którymi konto powstało, jego rolę przez
  identyfikator i to, czy adres został potwierdzony. `customer_account.create`
  jest poleceniem: pierwszego użytkownika rejestrującej się firmy tworzy ono
  w transakcji rejestracji, więc jego wpis powstaje razem z wpisem
  `organization.register` i ma ten sam identyfikator żądania;
- przeniesienie między Organizacjami (`customer_account.organization_assigned`,
  `.organization_unassigned`, `.attach_organization`) jest zapisywane jako
  `changedFields: ['organizationId', 'organizationRoleId']`, z identyfikatorami
  ról, ale bez Organizacji;
- blokada (`customer_account.blocked`, `.unblocked`) zapisuje moment, źródło i
  `hasBlockReason`, nigdy sam powód;
- zmiana pól niestandardowych (`customer.custom_fields.update`) wymienia
  zmienione klucze jako `changedCustomFields`;
- zmiana roli zapisuje rolę przez identyfikator i rodzaj, nigdy nazwę roli
  niestandardowej;
- zmiana preferowanego języka (`customer_account.set_preferred_language`)
  zapisuje `changedFields: ['preferredLanguage']` i jej źródło jako `source`
  (`self_service` albo `sign_in`), nigdy sam język;
- zmiana zbiorczego widoku (`customer_account.set_subtree_rollup`) zapisuje
  flagę `subtreeRollupEnabled` przed zmianą i po niej. To polecenie, więc wpis
  powstaje w transakcji zmiany.

Wartości przechowuje samo konto.

## Preferowany język

Każde konto może zapisać język, w którym czyta jego właściciel, jako
`CustomerAccountRecord.preferredLanguage`: jeden znacznik języka, zapisany tak,
jak zapisuje go kanał sprzedaży, który go przechwycił (`pl-PL`, `en-US`), albo
`null`, dopóki nie jest znany. W tym języku mają być pisane e-maile tworzone dla
konta poza żądaniem. Wewnątrz żądania nic się nie zmienia: język odpowiedzi
nadal wynika z nagłówka `Accept-Language` żądania.

**Skąd się bierze.**

- **Przy tworzeniu konta** — z żądania, które je tworzy: nagłówek
  `Accept-Language`, dopasowany do kanału sprzedaży żądania — znaczniki w
  kolejności preferencji (`q`), każdy dokładnie albo według języka bazowego
  (`en` → `en-US`); wygrywa pierwszy, który kanał oferuje, a w ostateczności
  domyślny język kanału.
  Dotyczy to rejestracji firmy, rejestracji klienta indywidualnego (B2C),
  przyjęcia zaproszenia (język zaproszonego, nie zapraszającego) i pierwszego
  logowania przez zewnętrznego dostawcę tożsamości (język strony, na której
  logowanie rozpoczęto). Konto utworzone przez operatora w panelu organizacji
  nie zapisuje żadnego.
- **Przy logowaniu, tylko dopóki jest nieznany** — dla konta sprzed wprowadzenia
  tego pola albo utworzonego przez operatora. Język jest zapisywany po
  zaakceptowaniu hasła, blokady i dostępu do sklepu, zanim padnie pytanie o drugi
  składnik; logowanie przez dostawcę tożsamości do istniejącego konta działa tak
  samo. Odrzucone logowanie niczego nie zapisuje, operator działający w imieniu
  klienta niczego nie zapisuje, a logowanie nigdy nie zastępuje języka, który
  konto już ma. Jeśli zapis się nie powiedzie, logowanie i tak się udaje.
- **Wybór samego klienta** na stronie konta w sklepie — jedyne, co zastępuje
  zapisany język. Zob. moduł `customers`.

**Odczyt.** `customerAccountReadPort` zwraca to pole w każdym rekordzie. Nadawca
dopasowuje je do kanału, dla którego tworzy wiadomość:
`scopeLanguageOf(renderChannel, preferredLanguage)` — dokładnie ten język, w
przeciwnym razie język o tym samym języku bazowym, a w ostateczności domyślny
język tego kanału. Język, którego kanał już nie oferuje, prowadzi więc do języka
zastępczego zamiast do błędu, a gdy kanał wycofuje język, niczego się nie
migruje.

**Zapis z innego modułu.** `customerAccountPreferencePort` ma dwie metody i obie
wykonują polecenie `customer_account.set_preferred_language`:
`setPreferredLanguage(customerAccountId, tag)` zapisuje znacznik w otrzymanej
postaci (wywołujący sprawdził go względem kanału żądania) i odpowiada 404
`NOT_FOUND` dla nieznanego konta; `captureIfUnset(customerAccountId, tag)`
zapisuje tylko wtedy, gdy konto nie ma języka, a w przeciwnym razie nic nie
robi — bez zapisu i bez wpisu audytu.

**Dane osobowe.** Język opisuje osobę. Nigdy nie trafia do wpisu audytu ani do
logów, a anonimizacja usuwa go razem z imieniem, nazwiskiem i adresem e-mail;
konto zanonimizowane przed wprowadzeniem tego pola, które nadal go ma, kończy
najbliższe przejście anonimizacji.

## Encje

`CustomerAccount` (e-mail, passwordHash, organizationRoleId, preferredLanguage), `PasswordResetToken`.
`organizationRoleId` wskazuje rolę konta w organizacji. Starsze, dwuwartościowe
pole `role` (`organization_admin | regular_user`) jest nadal utrzymywane zgodnie
z nią, dopóki platforma z niego nie zrezygnuje, i zostanie usunięte.

## Punkty rozszerzenia

- **Polityka haseł** — `password-hasher.ts` platformy (`packages/platform/src/kernel/crypto/`)
  opakowuje argon2id; tam dostosowuje się parametry kosztu.
- **Kody zapasowe i drugie składniki uwierzytelniania** — nie należą do tego modułu. Weryfikację dwuetapową klientów
  i administratorów obsługuje moduł `mfa`, na tabeli `mfa_enrolments`, udostępniony pod
  `/api/v1/account/mfa/*`; kody odzyskiwania to tam jednorazowe wiersze. Zastąpiony szkielet, na
  który ten punkt wcześniej wskazywał (`totp-enrolment-service.ts`), usunięto 2026-08-25 — nigdy
  nie pozwalał dokończyć ani jednej rejestracji drugiego składnika.

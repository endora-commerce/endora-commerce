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

- `customerAccountCommandPort.create(input, options?)` tworzy konto we własnej
  transakcji — korzysta z tego bezpośrednie dodanie członka przez operatora
  (zob. *Zapisy po stronie serwera* niżej);
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
  (`self_service`, `sign_in`, kod przekazany przez wywołującego po stronie
  serwera albo `null`, gdy żadnego nie przekazał), nigdy sam język;
- zmiana zbiorczego widoku (`customer_account.set_subtree_rollup`) zapisuje
  flagę `subtreeRollupEnabled` przed zmianą i po niej. To polecenie, więc wpis
  powstaje w transakcji zmiany.

Wartości przechowuje samo konto.

## Zapisy po stronie serwera

Inny moduł, moduł nakładki albo proces integracyjny (konektor ERP lub CRM) zapisuje konto
klienta przez **`customerAccountCommandPort`**, port zapisu konta, zadeklarowany jako
`CustomerAccountCommandPort` w `@endora-commerce/contracts`. Nigdy nie zapisuje sam tabeli tego
modułu. Pobieraj go przy każdym użyciu przez
`lazyPort<CustomerAccountCommandPort>(ctx, 'customerAccountCommandPort')`, z
`customer_accounts` w `dependencies` manifestu modułu wywołującego.

| Metoda | Akcja audytu | Co w panelu robi to samo |
| --- | --- | --- |
| `create(input, options?)` | `customer_account.create` | `POST /api/v1/admin/organizations/:id/members` |
| `createStandalone(input, options?)` | `customer_account.register_standalone` | — (rejestracja kupującego, `POST /api/v1/customers/register`) |
| `updateProfile(id, patch, options?)` | `customer_account.update_profile` | `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId` |
| `block(id, { reason? }, options?)` | `customer_account.blocked` | `POST /api/v1/admin/customers/:id/block` |
| `unblock(id, options?)` | `customer_account.unblocked` | `POST /api/v1/admin/customers/:id/unblock` |
| `softDelete(id, options?)` | `customer_account.deleted` | `DELETE /api/v1/admin/customers/:id` |
| `restore(id, options?)` | `customer_account.restored` | `POST /api/v1/admin/customers/:id/restore` |
| `setCustomerGroup(id, { customerGroupId }, options?)` | `customer_account.group_assigned` | `PUT /api/v1/admin/customers/:id/customer-group` |
| `setCustomFieldValues(id, merge, options?)` | `customer.custom_fields.update` | `PATCH /api/v1/admin/customers/:id/custom-fields` |
| `setSubtreeRollup(id, { enabled }, options?)` | `customer_account.set_subtree_rollup` | `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/rollup` |
| `promoteToOrganizationAdmin(id, options?)` | `customer_account.promote_organization_admin` | — |
| `markEmailVerified(id, { verifiedAt }, options?)` | `customer_account.email_verified` | — (link weryfikacyjny kupującego) |
| `changeRole(id, { organizationRoleId }, options?)` | `customer_account.change_role` | `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role` |
| `setPreferredLanguage(id, { language }, options?)` | `customer_account.set_preferred_language` | — (strona konta kupującego) |
| `removeMember(id, options?)` | `customer_account.remove_member` | `DELETE /api/v1/admin/organizations/:id/members/:customerAccountId` |
| `anonymize(id, options?)` | `customer_account.anonymized` | — (cykliczna anonimizacja po okresie przechowywania) |

**Jedna ścieżka zapisu.** Endpointy panelu modułów `customers` i `organizations` wywołują ten
port, więc kliknięcie operatora i wywołanie po stronie serwera uruchamiają to samo polecenie
(Command): jeden wpis audytu z tym samym stanem, we własnej transakcji zapisu. Endpointy panelu
członków zapisują dodatkowo własny wpis `customer_account.admin_*` (że operator edytował panel);
port go nie zapisuje. Dane wejściowe są walidowane w granicach endpointów, a odmowy to błędy
endpointów z ich kodami — `422 VALIDATION_FAILED` dla danych poza granicami, `404
CUSTOMER_NOT_FOUND` w metodach blokady, usunięcia, przywrócenia i grupy, a `404 NOT_FOUND`
w pozostałych, tak jak odpowiadają ich endpointy, oraz własne kody każdej operacji (`409
EMAIL_ALREADY_REGISTERED`, `409 CUSTOMER_ALREADY_DELETED`, `409 CUSTOMER_NOT_DELETED`, `409
CUSTOMER_RESTORE_WINDOW_ELAPSED`, `409 CANNOT_DEMOTE_LAST_ADMIN`, `409
CANNOT_REMOVE_LAST_ADMIN`).

**Blokowanie i usuwanie.** Obie operacje odmawiają z `409 ORG_OWNER_DEPLETION`, gdy organizacja
firmowa zostałaby bez aktywnego, niezablokowanego *Administratora*; posiadacze roli są blokowani
przed policzeniem, więc dwa takie zapisy nie mogą przejść jednocześnie. Jedynego członka
organizacji osobistej można zablokować i usunąć. Po zatwierdzeniu zapisu sesje konta są
kończone, więc zablokowany albo usunięty kupujący zostaje od razu wylogowany; gdy magazyn sesji
jest nieosiągalny, zapis pozostaje, a błąd trafia do logu. Zablokowanie konta już
zablokowanego albo odblokowanie niezablokowanego niczego nie zmienia ani nie zapisuje.

**Kto zapisał.** Aktor jest aktorem z bieżącego kontekstu, nigdy parametrem: administrator w
żądaniu panelu albo w `withSystemScopeActingFor`; aktor **system** w `withSystemScope` w procesie
w tle, który nie zapisuje administratora — blokada przez system zostawia
`blockedByAdminUserId` puste. Bez żadnego kontekstu tenanta zapis jest odrzucany, zanim
cokolwiek zostanie zapisane. Port nie sprawdza uprawnień — o dostępie decyduje wywołujący — więc
nigdy nie pobieraj go dla trasy dostępnej dla klienta. Nie ma w nim też własnych reguł panelu:
uprawnienia `customers:manage`, zasięgu przedstawiciela handlowego, sprawdzenia
`expectedUpdatedAt` w panelu członków ani okna przywracania z
`customers.deletion_retention_days`, które endpoint panelu stosuje, zanim cykliczna
anonimizacja dotrze do usuniętego konta.

**Opcje** (ostatni parametr każdej metody):

- `source` — kod z małych liter nazywający integrację (`erp`, `erp.customer-master`, co najwyżej
  64 znaki), zapisywany jako `source` we wpisie audytu obok aktora. Każda inna wartość jest
  odrzucana z `422 VALIDATION_FAILED`, zanim cokolwiek zostanie odczytane lub zapisane.
- `expectedVersion` — pomijana: konto nie ma wersji.
- `extensions` — dane dla hooków poleceń akcji, pod kluczem identyfikatora modułu hooka. Hooki
  mogą działać przed commitem i po nim na trzech akcjach: `customer_account.create` (`create`),
  `customer_account.update_profile` (`updateProfile`) i `customer.custom_fields.update`
  (`setCustomFieldValues`); ich referencje to `CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS` w
  `@endora-commerce/contracts`. Klucz, którego nie przejmuje żaden obecny moduł hooka na danej
  akcji — a na każdej innej metodzie każdy klucz — jest odrzucany z
  `422 COMMAND_EXTENSION_UNCLAIMED`, zanim cokolwiek zostanie zapisane.

**Czego port nie oferuje.** Przeniesienie konta do innej organizacji (metody
`setOrganization`, `detachToPersonalOrganization` i `attachToOrganization` starszych portów)
należy do członkostwa w organizacji, które ma własny port. Hasła, logowanie i jego limity to
uwierzytelnianie, a nie zapisy wykonywane przez integrację. Przechwycenie nieznanego
preferowanego języka przy logowaniu pozostaje w `customerAccountPreferencePort.captureIfUnset`,
a wybór kupującego na stronie konta — w `customerAccountPreferencePort.setPreferredLanguage`,
które uruchamia to samo polecenie z kodem `self_service`.

**Przestarzałe od 0.113.0.** `customerAccountLifecycleWritePort` i
`customerAccountMemberWritePort` uruchamiają te same polecenia i zostaną usunięte w następnym
wydaniu, z wyjątkiem przeniesień między organizacjami. Zamiast nich wywołuj metodę o tej samej
nazwie tutaj; `block`, `unblock`, `softDelete`, `restore` i `setCustomerGroup` nie przyjmują już
`actorAdminUserId`. Lista pracy cyklicznej anonimizacji, `listDueForAnonymization` i
`hasDueForAnonymization`, przeszła do `customerAccountReadPort`.

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

---
title: admin_users
description: Konta administratorów platformy i logowanie jako klient
---

# `admin_users`

Konta administratorów platformy (oddzielne od kont klientów) oraz logowanie jako klient
(impersonacja).

## API publiczne

Zarządzanie użytkownikami i rolami wymaga uprawnienia `admin_users:manage`.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/auth/admin/login` | Logowanie administratora (z weryfikacją 2FA, gdy wymaga tego rola). Powtarzane błędne hasła są ograniczane: 429 `ADMIN_AUTHENTICATION_THROTTLED` z nagłówkiem `Retry-After` — patrz niżej |
| `POST /api/v1/auth/admin/logout` | Zakończenie sesji administratora |
| `PATCH /api/v1/admin/me` | Zalogowany administrator edytuje własne imię i nazwisko oraz zmienia własne hasło; nie jest potrzebne żadne uprawnienie. Nowe `password` musi być wysłane razem z `currentPassword`: bez niego żądanie jest odrzucane z 400 `VALIDATION_FAILED`, z błędnym — z 403 `CURRENT_PASSWORD_INVALID`, z nowym hasłem takim samym jak obecne — z 400 `NEW_PASSWORD_UNCHANGED`, a odrzucone żądanie niczego nie zmienia — imienia i nazwiska również. Przyjęta zmiana hasła wylogowuje wszystkie pozostałe sesje konta (zob. *Sesje a zmiana hasła*). Powtarzane błędne bieżące hasła są ograniczane tak samo jak błędne hasła przy logowaniu (429 `ADMIN_AUTHENTICATION_THROTTLED`) |
| `GET /api/v1/admin/admin-users` | Lista administratorów (usunięte konta są pomijane) |
| `POST /api/v1/admin/admin-users` | Utworzenie administratora. Pole `adminRoleId` jest wymagane: konto bez roli jest odrzucane z 400 `ADMIN_USER_ROLE_REQUIRED`. Powtórzony e-mail jest odrzucany z `EMAIL_ALREADY_REGISTERED` |
| `PATCH /api/v1/admin/admin-users/:id` | Aktualizacja imienia, przypisanej roli lub statusu; nie ustawia hasła — pole `password` jest odrzucane z 400 `VALIDATION_FAILED`. Rolę można zmienić na inną, ale nie można jej usunąć: `adminRoleId: null` jest odrzucane z 400 `ADMIN_USER_ROLE_REQUIRED`. Ustawienie `status: 'inactive'` wylogowuje konto ze wszystkich sesji |
| `DELETE /api/v1/admin/admin-users/:id` | Usunięcie miękkie (ustawia `deletedAt` i `status='inactive'`) oraz wylogowanie konta ze wszystkich sesji |
| `GET /api/v1/admin/admin-roles` | Lista ról z tablicami uprawnień |
| `PUT /api/v1/admin/admin-roles/:code` | Utworzenie lub aktualizacja roli według kodu; nieznane uprawnienia zwracają 400 `VALIDATION_FAILED` |
| `DELETE /api/v1/admin/admin-roles/:id` | Usunięcie; odrzucane z 409 `ADMIN_ROLE_IN_USE`, gdy rola jest nadal przypisana do jakiegokolwiek użytkownika — **także usuniętego miękko**, bo jego przypisanie wraca po przywróceniu konta. Odpowiedź wskazuje, która grupa ma tę rolę (`details.code` to `assigned` albo `assigned_to_deleted`) i ilu jest takich użytkowników |
| `GET /api/v1/admin/permissions` | Kanoniczny katalog uprawnień (moduł / kod / etykieta), z którego korzysta macierz uprawnień w panelu |
| `POST /api/v1/admin/organizations/:id/impersonate` | Rozpoczęcie logowania jako klient; przed wydaniem ciasteczka zapisuje wpis audytu `impersonation.start` |
| `POST /api/v1/admin/impersonation/end` | Powrót do pierwotnej sesji administratora |

## Każdy administrator ma rolę

Uprawnienia administratora i organizacje, do których ma dostęp, wynikają z roli przypisanej do
konta, dlatego konto ma zawsze dokładnie jedną rolę. Panel i API odmawiają utworzenia konta bez
roli oraz usunięcia roli z istniejącego konta, a polecenie `admin_users create` przypisuje rolę
`platform_admin`, chyba że `--role` wskazuje inną.

Konto, które mimo to nie ma roli — utworzone przed wprowadzeniem tej reguły — jest odrzucane,
a nie interpretowane: trasa chroniona uprawnieniem odpowiada 403 `ADMIN_ROLE_REQUIRED`, tak samo
jak pierwszy odczyt danych organizacji. Takie konto nigdy nie jest traktowane jak konto
z dostępem do wszystkich organizacji. Nadal może się zalogować, sprawdzić, kim jest
(`GET /api/v1/admin/me` zwraca `role: null`), i się wylogować.

Przy starcie moduł zapisuje ostrzeżenie z liczbą kont bez roli. Przypisz każdemu rolę na ekranie
Użytkownicy albo — gdy żaden administrator nie może się zalogować — z wiersza poleceń:

```bash
pnpm run admin:create -- --email=<adres e-mail konta> --password-stdin \
  --first-name=<imię> --last-name=<nazwisko> [--role=<kod>]
```

Polecenie aktualizuje istniejące konto, ustawia podane hasło i przypisuje rolę `platform_admin`,
chyba że `--role` wskazuje inną. Przy aktualizacji konta nie dostają roli automatycznie:
oznaczałoby to nadanie dostępu, o którym nikt nie zdecydował.

## Sesje a zmiana hasła

Sesja jest poświadczeniem, dlatego jest unieważniana wtedy, gdy przestaje obowiązywać to, co
potwierdzała:

| Zapis | Unieważniane sesje |
| --- | --- |
| Administrator zmienia własne hasło (`PATCH /api/v1/admin/me`) | Wszystkie sesje konta **poza tą, z której wysłano żądanie** |
| Inny administrator resetuje hasło (`POST /api/v1/admin/admin-users/:id/password`) | Wszystkie sesje konta |
| Konto zostaje dezaktywowane (`status: 'inactive'`) albo usunięte | Wszystkie sesje konta |
| Polecenie `admin_users create` (`admin:create`) zostaje uruchomione ponownie dla konta, które już istnieje | Wszystkie sesje konta. Zapis trafia do dziennika audytu jako `admin_user.change_password` z `via: 'cli'` i bez administratora wykonującego |
| Administrator wyłącza własne uwierzytelnianie dwuskładnikowe (`POST /api/v1/admin/account/mfa/disable`) | Wszystkie sesje konta **poza tą, z której wysłano żądanie** |

„Wszystkie sesje” to logowania w innych przeglądarkach i na innych urządzeniach oraz sesje
logowania jako klient rozpoczęte przez tego administratora. Te same zapisy wycofują każde
logowanie, które konto rozpoczęło i którego nie dokończyło — oczekującą weryfikację drugiego
składnika albo bilet konfiguracji uwierzytelniania dwuskładnikowego — dlatego logowania
rozpoczętego starym hasłem nie da się później dokończyć. Najpierw zapisywany jest nowy stan,
a dopiero potem unieważniane są sesje, więc po unieważnieniu nie da się już niczego uzyskać
starym hasłem. Po samodzielnej zmianie hasła
administrator pozostaje zalogowany tam, gdzie ją wykonał — nie jest wydawane nowe ciasteczko,
a ekran profilu pozostaje otwarty — natomiast wszędzie indziej musi zalogować się ponownie, już
nowym hasłem. Odrzucona zmiana (błędne albo brakujące `currentPassword`) nie unieważnia żadnej
sesji, podobnie jak żądanie zmieniające wyłącznie imię lub nazwisko.

Unieważnienie nie jest jedynym zabezpieczeniem. Strażnik tras administracyjnych odrzuca również
sesję konta, które nie jest już aktywne — dezaktywowanego, usuniętego albo nieistniejącego —
z kodem 401, na każdej chronionej trasie, niezależnie od tego, czy cokolwiek tę sesję unieważniło.
Aktywne konto bez wymaganego uprawnienia nadal otrzymuje 403.

Odrzucona zmiana hasła nie jest zapisywana w dzienniku audytu, podobnie jak nieudane logowanie.

Klucze API nie są sesjami i pozostają bez zmian, tak samo jak drugi składnik uwierzytelniania
konta. Ponowne uruchomienie `admin_users create` dla istniejącego konta zastępuje jego hasło, ale
nie unieważnia jego sesji.

Oba zapisy hasła trafiają do dziennika audytu jako `admin_user.change_password`. Rozróżnia je pole
`via` wpisu — `self_service` albo `peer_reset` — oraz wykonawca, a wpis nigdy nie zawiera hasła
ani jego skrótu. Samodzielne żądanie, które zmienia także imię lub nazwisko, zapisuje obok wpis
`admin_user.update`.

## Ograniczanie powtarzanych błędnych haseł i kodów

Hasło lub kod drugiego składnika dla konta administratora można podać błędnie
tylko kilka razy z rzędu. Potem próba otrzymuje odpowiedź **429
`ADMIN_AUTHENTICATION_THROTTLED`** — z nagłówkiem `Retry-After` i tą samą liczbą
sekund w `error.details.retryAfterSeconds` — dopóki nie upłynie czas
wstrzymania.

| Kto próbuje | Błędne próby przed wstrzymaniem | Liczone przez |
| --- | --- | --- |
| Jeden adres na jednym koncie | 5 | 30 minut od pierwszej błędnej próby |
| Jedno konto, ze wszystkich adresów, które nie są znanym urządzeniem | 20 | 30 minut od pierwszej błędnej próby |
| Jedno znane urządzenie na swoim koncie | 5 | 30 minut od pierwszej błędnej próby |

Pierwsze wstrzymanie trwa minutę. Każda kolejna błędna próba, podjęta po
zakończeniu wstrzymania, rozpoczyna następne, dwa razy dłuższe — dwie, cztery,
osiem minut — ale nie dłuższe niż piętnaście minut. Udana próba od razu zeruje
licznik; w przeciwnym razie próby są zapominane po 30 minutach od pierwszej
błędnej. Nic nie jest blokowane na stałe.

Adres to adres IPv4 klienta albo, dla IPv6, jego sieć /64 — wszystkie hosty
jednej sieci IPv6 /64 mają wspólny limit. Adres IPv4 zapisany w postaci IPv6
(`::ffff:203.0.113.9`) jest liczony jako adres IPv4.

Co to oznacza w praktyce:

- **W czasie wstrzymania odrzucane jest także poprawne hasło i poprawny kod.**
  Nie są w ogóle sprawdzane, więc odpowiedź jest taka sama niezależnie od tego,
  czy były poprawne. Odczekaj czas podany w `Retry-After` i spróbuj ponownie.
- **Adres e-mail, który nie należy do żadnego administratora, jest ograniczany
  tak samo**, więc odpowiedź nie zdradza, które adresy mają konta.
- **Hasła i kody drugiego składnika są liczone osobno.** Hasło jest liczone
  wszędzie tam, gdzie się o nie pyta — przy logowaniu, jako bieżące hasło, gdy
  administrator zmienia własne, oraz przy potwierdzaniu wyłączenia
  uwierzytelniania dwuskładnikowego — i tak samo kod: w drugim kroku
  logowania, przy potwierdzaniu wyłączenia uwierzytelniania dwuskładnikowego
  oraz przy ponownym generowaniu kodów odzyskiwania.
- **Jednocześnie sprawdzanych jest najwyżej pięć prób z jednego adresu** (20
  dla jednego konta). Próba ponad ten limit otrzymuje 429 z `Retry-After: 1`
  i nie jest sprawdzana; wysłana ponownie sekundę później — już tak. To właśnie
  zatrzymuje serię równoległych prób zgadywania i dotyczy także poprawnych
  danych: z dwunastu poprawnych logowań wysłanych w tej samej chwili z jednego
  adresu co najmniej pięć się powiedzie, a pozostałe dostaną polecenie
  ponowienia za sekundę. Nic nie jest za nie doliczane do konta.
- **Ile prób zgadywania pozostaje możliwych:** z jednego adresu 9 w ciągu 30
  minut; dla jednego konta, z dowolnej liczby adresów, 24 w ciągu 30 minut —
  około 1150 na dobę.

### Znane urządzenia

Ukończone logowanie — hasło oraz, jeśli konto go używa, drugi składnik —
zostawia na urządzeniu plik cookie `b2b_admin_device`. Jest podpisany sekretem
plików cookie serwera (`SESSION_COOKIE_SECRET`), ma atrybut `httpOnly` i jest
przechowywany przez 90 dni od ostatniego logowania. Nie jest sesją i nie daje
żadnego dostępu: urządzenie, które go ma, nadal musi podać hasło i kod.

Jedyne, na co wpływa, to ograniczanie prób. Próba ze znanego urządzenia jest
liczona w ramach własnego limitu pięciu prób tego urządzenia; nie jest ani
doliczana do limitu dwudziestu prób, który konto ma dla wszystkich pozostałych,
ani przez ten limit odrzucana. Dlatego:

- **Błędne hasła wysyłane przez kogoś innego nie odetną administratora od
  urządzenia, na którym już się logował.** Licznik całego konta to jedyny,
  który może zapełnić obca osoba, a znane urządzenie mu nie podlega.
- **Znane urządzenie nadal można wstrzymać jego własnymi błędnymi próbami** —
  pięć, a potem opisane wyżej wstrzymania, niezależnie od tego, skąd się łączy.
- **Urządzenie, na którym nigdy nie logowano się na to konto, nie jest
  chronione.** Ktoś, kto zna adres e-mail administratora, może opóźnić
  logowanie z takiego urządzenia, wysyłając 20 błędnych haseł z co najmniej
  czterech adresów, i podtrzymywać to opóźnienie mniej więcej 50 żądaniami na
  godzinę. Użyj urządzenia, na którym już się logowano, albo poproś osobę
  z dostępem do serwera o uruchomienie opisanego niżej polecenia odblokowania.
  (To „przypadek niechroniony”, do którego odwołują się dalsze punkty.)
- **Wyjątek jest związany z hasłem i z niczym innym.** Plik cookie przestaje
  być honorowany, gdy zmieni się hasło konta — zmienione przez samego
  administratora, przez reset wykonany przez innego administratora albo przez
  `admin_users create` — i każde urządzenie musi wtedy
  ponownie ukończyć logowanie, żeby stać się znanym. Nie jest honorowany, dopóki
  konto jest dezaktywowane lub usunięte, ale **ponowna aktywacja konta z tym
  samym hasłem przywraca pliki cookie, które jego urządzenia już mają**. Reset
  uwierzytelniania dwuskładnikowego, jego włączenie ani wyłączenie ich nie
  unieważnia. Żeby wszystkie urządzenia konta stały się nieznane, zmień jego
  hasło.
- **Plik cookie ustawia wyłącznie logowanie hasłem.** Konto, które loguje się
  tylko przez Google lub Microsoft, nigdy go nie otrzymuje, więc jego
  urządzenia nigdy nie są znane i zawsze podlegają licznikowi całego konta.
- **Ochrona obejmuje wyłącznie urządzenia powracające.** Tam, gdzie każdy
  administrator loguje się z urządzenia, na którym nigdy nie używano tego konta
  — typowym przykładem jest publiczne demo ze wspólnymi danymi logowania — nikt
  nie ma pliku cookie, a ktoś wysyłający błędne hasła opóźnia logowanie
  wszystkim: to opisany wyżej przypadek niechroniony, tyle że dla każdego.
- Wyczyszczenie plików cookie w przeglądarce albo zmiana
  `SESSION_COOKIE_SECRET` sprawia, że urządzenie znów jest nieznane. Nic się
  nie psuje; następne ukończone logowanie ustawia nowy plik cookie.

### Odblokowanie konta z wiersza poleceń

`admin_users unlock` zapomina wszystkie liczniki jednego konta — haseł i kodów
drugiego składnika, wszystkich adresów i urządzeń — dzięki czemu następna próba
skądkolwiek zostanie dopuszczona. Wymaga powłoki na instancji i działa na tym
Redisie, który wskazuje jego środowisko. Pierwszy wiersz wyniku mówi, na którym
— host, port i numer bazy — żeby komunikatu „nic nie było wstrzymane”
z Redisa, którego instancja nie używa, nie dało się pomylić z kontem, które
nie było wstrzymane.

| Gdzie | Polecenie |
| --- | --- |
| Instancja, na własnym komputerze (z jej katalogu głównego) | `pnpm run cli admin_users unlock --email=<adres e-mail>` |
| Obraz produkcyjny | `node dist/cli.js admin_users unlock --email=<adres e-mail>`, uruchomione w kontenerze backendu |
| Klon repozytorium Endora Commerce | `pnpm --filter backend run cli -- admin_users unlock --email=<adres e-mail>` |

Zaloguj się zaraz po jego uruchomieniu: urządzenie staje się wtedy znane. Jeśli
błędne hasła nadal napływają, konto zostanie ponownie wstrzymane po kolejnych
20. Polecenie nie zmienia hasła, nie kończy żadnej sesji i nie dotyka drugiego
składnika. Zapisuje jeden wpis dziennika audytu,
`admin_user.authentication_throttle_cleared`, bez wskazania administratora,
który wykonał operację: polecenie uruchamia się z powłoki, a nie z konta
zalogowanej osoby.

### Za odwrotnym serwerem pośredniczącym

Ustaw `TRUSTED_PROXY_HOPS` albo `TRUSTED_PROXY_ADDRESSES`. Bez tego każde
żądanie wygląda tak, jakby pochodziło od serwera pośredniczącego, więc wszyscy
klienci mają jeden wspólny adres: pięć błędnych haseł od kogokolwiek wstrzymuje
wtedy każde urządzenie, które nie jest znane, dla każdego konta, na którym je
wypróbowano.

### Instancje demonstracyjne, które publikują hasło administratora

Limit dla całego konta — 20 błędnych haseł dla jednego konta ze wszystkich
adresów, które nie są znanym urządzeniem — zakłada, że hasło jest tajne.
Publiczne demo, które wypisuje adres e-mail i hasło administratora na stronie
logowania, łamie to założenie: każdy odwiedzający jest urządzeniem logującym
się po raz pierwszy, więc ktokolwiek może zablokować je wszystkie dwudziestoma
błędnymi hasłami i kilkoma kolejnymi co pół godziny.

Dla takiej instancji, i tylko dla takiej, ustaw

```bash
ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off
```

w środowisku backendu i uruchom go ponownie. Co się zmienia, a co nie:

- **Wyłączone:** liczenie błędnych **haseł** dla całego konta. Urządzenie
  logujące się po raz pierwszy jest wtedy odrzucane wyłącznie za błędne próby
  z własnego adresu.
- **Nadal włączone:** limit pięciu prób z jednego adresu na jednym koncie,
  limit pięciu prób dla znanego urządzenia, oba limity kodów drugiego
  składnika — łącznie z limitem dla całego konta — oraz same opóźnienia.
- Żądanie, które dociera do backendu bez żadnego adresu klienta, jest nadal
  liczone dla konta, aby żadna próba nie pozostała niepoliczona.

**Nie ustawiaj tej zmiennej na instancji, której hasła administratorów nie są
publiczne.** Tam limit dla całego konta ogranicza zgadywanie rozłożone na wiele
adresów: bez niego ktoś, kto ma tysiąc adresów, dostaje pięć prób z każdego
z nich co pół godziny.

To celowo zmienna środowiskowa, a nie ustawienie — ustawienie byłoby
przełącznikiem w panelu administracyjnym, który ten limit chroni. Limit wyłącza
tylko dokładna wartość `off` — małymi literami, bez żadnych znaków dookoła;
każda inna, także `OFF`, pozostawia go włączonym i zapisuje ostrzeżenie w logu. Gdy limit jest wyłączony, backend przy każdym starcie zapisuje w logu
ostrzeżenie:

```text
account-wide administrator attempt limit is OFF — intended for demo instances with published credentials
```

### Co widzi operator

Za każdym razem, gdy dla istniejącego konta rozpoczyna się wstrzymanie,
zapisywany jest jeden wpis dziennika audytu z akcją
`admin_user.authentication_throttled`: konto jako obiekt, adres klienta, a w
`stateAfter` pola `factor` (`password` albo `second_factor`), `scope`
(`address`, `account` albo `device`) i `retryAfterSeconds`. Próby odrzucone
w czasie wstrzymania nie zapisują niczego, podobnie jak wstrzymanie dla adresu,
który nie należy do żadnego konta — to drugie trafia wyłącznie do logu serwera
jako ostrzeżenie. Podane hasło ani kod nigdy nie są zapisywane.

Liczby podane na tej stronie są ustalone w module i nie są ustawieniami.

### Gdy Redis jest niedostępny

Liczniki są przechowywane w Redisie. Gdy nie odpowie on w ciągu trzech sekund,
próba jest odrzucana z **503 `ADMIN_AUTHENTICATION_UNAVAILABLE`** i
`Retry-After: 5`, bez sprawdzania. Nikt nie może się zalogować, dopóki Redis
nie wróci; sesje także są tam przechowywane.

Próba, która została dopuszczona, ale której wyniku nie udało się zapisać —
weryfikacja się zawiesiła, proces się zatrzymał albo Redis zniknął między
dwoma krokami — po 30 sekundach jest liczona jako błędna. Dlatego awaria
Redisa albo seria krótkich przerw może pozostawić kilka prób doliczonych do
konta, przy którym nikt się nie pomylił. Są zapominane jak wszystkie inne: po
następnym udanym logowaniu albo po 30 minutach od pierwszej.

### Dla autorów modułów

Inny moduł, który weryfikuje dane uwierzytelniające administratora, korzysta z
tych samych liczników przez port `adminAuthenticationThrottlePort`
(`AdminAuthenticationThrottlePort` w `@endora-commerce/contracts`), obejmując
porównanie jednym wywołaniem `verify(attempt, check)`. Próba niesie adres
klienta i zweryfikowaną wartość pliku cookie znanego urządzenia.

## Logowanie jako klient

`impersonation-service.ts` realizuje wzorzec przełączenia użytkownika: rozpoczyna nową sesję
przypisaną do docelowego klienta, z zapamiętanym w tle identyfikatorem administratora, i kończy ją
czysto, zapisując `impersonation.end`. Każda czynność wykonana w takiej sesji jest zapisywana w
dzienniku audytu zarówno z `actorAdminUserId`, jak i z `impersonatedCustomerAccountId`.

## Encje

`AdminUser` (e-mail, passwordHash, stan uwierzytelniania dwuskładnikowego, jedno `adminRoleId`,
`status`, usunięcie miękkie przez `deletedAt`).

`AdminRole` (kod, nazwa wyświetlana, JSONB `permissions[]`, `requiresTwoFactor`). Symbol
wieloznaczny `*` służy wyłącznie do inicjalizacji platformy i jest odrzucany przez trasę zapisu
roli.

## Punkty rozszerzenia

- **Własne etapy logowania** — miejsce przed weryfikacją hasła w `admin-auth-service.ts`.
- **Odbiorcy audytu logowania jako klient** — każdy wpis audytu z akcją `impersonation.start|end`
  ma tę samą strukturę; raportowanie w dalszych systemach może łączyć dane właśnie po nich.

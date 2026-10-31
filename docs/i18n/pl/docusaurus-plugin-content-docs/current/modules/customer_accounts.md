---
title: customer_accounts
description: Logowanie klientów, reset hasła, weryfikacja dwuetapowa, przypisanie roli
---

# `customer_accounts`

Dane każdego użytkownika po stronie klienta: logowanie, zarządzanie hasłem, opcjonalna weryfikacja dwuetapowa i rola
w organizacji. Moduł korzysta ze wspólnej usługi sesji z `auth`; odpowiada za tożsamość użytkowników
po stronie klienta.

## API publiczne

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/auth/login` | E-mail i hasło (oraz krok TOTP, gdy włączona jest weryfikacja dwuetapowa) |
| `POST /api/v1/auth/logout` | Zakończenie sesji |
| `POST /api/v1/me/password` | Zmiana hasła (odrzuca błędne `currentPassword`). Udana zmiana wylogowuje konto ze wszystkich pozostałych sesji (sesja, z której wysłano żądanie, zostaje), unieważnia niewykorzystane tokeny resetu hasła i wycofuje każde rozpoczęte, a niedokończone logowanie. |
| `POST /api/v1/auth/password-reset/request` | Rozpoczęcie resetu hasła. Nowy link unieważnia wszystkie wcześniejsze niewykorzystane, więc działa tylko ten z najnowszej wiadomości. Powtarzane żądania dla jednego adresu są ograniczane (zob. niżej) |
| `POST /api/v1/auth/password-reset/confirm` | Użycie tokenu resetu hasła. Wykorzystanie tokenu wylogowuje konto ze **wszystkich** sesji, unieważnia pozostałe niewykorzystane tokeny resetu i wycofuje każde rozpoczęte, a niedokończone logowanie. |

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

## Encje

`CustomerAccount` (e-mail, passwordHash, rola), `PasswordResetToken`. Rola to wyliczenie
`organization_admin | regular_user`.

## Punkty rozszerzenia

- **Polityka haseł** — `password-hasher.ts` opakowuje argon2id; tam dostosowuje się parametry
  kosztu.
- **Kody zapasowe i drugie składniki uwierzytelniania** — nie należą do tego modułu. Weryfikację dwuetapową klientów
  i administratorów obsługuje moduł `mfa`, na tabeli `mfa_enrolments`, udostępniony pod
  `/api/v1/account/mfa/*`; kody odzyskiwania to tam jednorazowe wiersze. Zastąpiony szkielet, na
  który ten punkt wcześniej wskazywał (`totp-enrolment-service.ts`), usunięto 2026-08-25 — nigdy
  nie pozwalał dokończyć ani jednej rejestracji drugiego składnika.

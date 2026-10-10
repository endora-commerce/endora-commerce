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
| `POST /api/v1/auth/admin/login` | Logowanie administratora (z weryfikacją 2FA, gdy wymaga tego rola) |
| `POST /api/v1/auth/admin/logout` | Zakończenie sesji administratora |
| `PATCH /api/v1/admin/me` | Zalogowany administrator edytuje własne imię i nazwisko oraz zmienia własne hasło; nie jest potrzebne żadne uprawnienie. Nowe `password` musi być wysłane razem z `currentPassword`: bez niego żądanie jest odrzucane z 400 `VALIDATION_FAILED`, z błędnym — z 403 `CURRENT_PASSWORD_INVALID`, z nowym hasłem takim samym jak obecne — z 400 `NEW_PASSWORD_UNCHANGED`, a odrzucone żądanie niczego nie zmienia — imienia i nazwiska również. Przyjęta zmiana hasła wylogowuje wszystkie pozostałe sesje konta (zob. *Sesje a zmiana hasła*) |
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

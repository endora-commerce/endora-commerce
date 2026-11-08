---
title: Dziennik audytu
description: Dziennik audytu wrażliwych operacji
---

# Dziennik audytu (`audit_logs`)

Dziennik audytu każdej wrażliwej operacji, do którego można wyłącznie dopisywać, z jednym
wyjątkiem: usuwaniem danych przy anonimizacji (zobacz *Usuwanie danych przy anonimizacji* niżej).
Każdy wpis zapisuje, kto, co i kiedy zrobił — a podczas logowania jako klient także w czyim
imieniu.

Wykonawca jest jednym z trzech. Administrator (`actorAdminUserId`) jest pokazywany z imieniem,
nazwiskiem i adresem e-mail. Klient działający we własnym imieniu w sklepie
(`actorCustomerAccountId`), na przykład administrator organizacji zarządzający rolami,
zaproszeniami lub członkami, jest pokazywany jako *Klient: …*. Wpis bez żadnego z nich jest
pokazywany jako *system*. Podczas logowania jako klient wpis wskazuje faktycznego administratora,
a klienta zapisuje w `impersonatedCustomerAccountId`; `actorCustomerAccountId` pozostaje wtedy puste.

## API publiczne

Wymaga uprawnienia `audit_log:read`.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/audit-log` | Zapytanie do dziennika. Filtry: `filter[actor]`, `filter[customer]`, `filter[action]`, `filter[objectType]`, `filter[objectId]`. Domyślnie `limit=100`, najwyżej 500. Każdy wiersz zawiera od razu JSON `stateBefore` / `stateAfter`, aby przeglądarka w panelu mogła pokazać różnice obok siebie bez drugiego zapytania. Wiersz zawiera też `actorCustomerAccountId` i `actorCustomerLabel` — etykietę klienta w dzienniku audytu: osobę w postaci *Imię Nazwisko (e-mail)*, a gdy konto nie ma imienia ani nazwiska — sam adres e-mail. Klient, pod którego podszywa się administrator, jest opisywany tak samo. |

## Zapisywanie

`AuditPort.record({ ... })` jest wywoływany przy każdej wrażliwej zmianie: zmianie ceny w katalogu,
zmianie roli, korekcie limitu kredytowego, zmianie statusu zamówienia lub płatności „w imieniu”
klienta, rozpoczęciu i zakończeniu logowania jako klient, użyciu klucza API poza jego zakresem i
innych. Dodanie nowej wrażliwej zmiany to dwa wiersze w miejscu wywołania.

Port to typ, którego używa moduł, a publikuje jądro (`packages/platform/src/kernel/ports/audit.ts`);
nazwa w kontenerze, pod którą jest rejestrowany, to `auditLogService` i się nie zmieniła.
Implementacja za nim, `AuditLogService`, należy do platformy i jest dostępna tylko przez ścieżkę
względną — moduł, który odwoływałby się do tej klasy, zależałby od kształtu mechanizmu zapisu,
który jednolity audyt zapisów omija, bo zapis domenowy przechodzi przez `CommandBus.run`, a to
Command Bus zapisuje wpis.

## Usuwanie danych przy anonimizacji

Gdy proces retencji anonimizuje usuniętego klienta, platforma usuwa też dane osobowe tego klienta
z historii audytu, w miejscu. To jedyna zmiana, jaka kiedykolwiek dotyka istniejącego wpisu.

**Zakres.** Wpisy o koncie klienta, jego organizacji osobistej, adresach tej organizacji (także
tych, które klient wcześniej usunął) i jego dawnych adresach klienta. Wpisy o czymkolwiek innym
zachowują własne migawki, tak jak same obiekty: zamówienie złożone przez klienta zachowuje swoją
historię, choć to klient ją zapisał.

**Co zostaje.** Każdy wpis, jego akcja, wykonawcy, czas, obiekt i identyfikator żądania. W
`stateBefore` i `stateAfter` zostaje każdy klucz, więc historia nadal pokazuje, *które* pola się
zmieniły. Wartość zostaje tylko wtedy, gdy jest jedną z poniższych:

| Zostaje | Na przykład |
| --- | --- |
| identyfikator (klucz `id` lub kończący się na `Id`/`Ids`) zawierający UUID | `organizationId` |
| znacznik czasu (klucz kończący się na `At`) zawierający datę i godzinę ISO-8601 | `blockedAt` |
| krótki kod pod kluczem kodu (`status`, `kind`, `type`, `source`, `action`, `version`, `statusCode` lub klucz wskazany przez moduł, do którego należy obiekt) | `status: "blocked"` |
| lista nazw kluczy pod kluczem kończącym się na `Keys` | `customFieldKeys` |
| wartość logiczna albo `null` | `isDefault: true` |

Każda inna wartość zmienia się w znacznik `"[erased]"`. Dotyczy to imion i nazwisk, adresów
e-mail, adresów i numerów telefonów, każdego dowolnego tekstu oraz **każdej wartości pola
niestandardowego**, niezależnie od jej typu. Numer NIP czy identyfikator zewnętrzny też jest
usuwany, bo nie jest UUID. We wpisach, które klient zapisał we własnym imieniu, usuwane są też adres
IP i identyfikator przeglądarki (user agent). We wpisie zapisanym przez administratora należą one
do administratora i zostają.

**Ślad operacji.** Każdy zanonimizowany klient dostaje jeden wpis `audit.redacted`, zapisany przez
system, dotyczący konta klienta. Zawiera tylko liczby i identyfikatory: ile wpisów było w zakresie
i ile się zmieniło, w podziale na typy obiektów.

**Idempotentne i nieodwracalne.** Wpis już wyczyszczony nie jest zapisywany ponownie, więc drugie
uruchomienie niczego nie zmienia i nie zapisuje drugiego wpisu `audit.redacted`. Uruchomienie
przerwane w połowie kończy następne. Usuniętych wartości nic nie przechowuje: nie da się ich
przywrócić.

**W przeglądarce dziennika.** Przeglądarka dziennika audytu w panelu pokazuje usuniętą wartość jako
*Usunięto*, a ostatnia aktywność na pulpicie nigdy nie pokazuje znacznika jako nazwy. Surowy JSON,
polecenie CLI `audit:read` i każdy eksport pokazują zapisany `"[erased]"`.

Ten zapis należy do właściciela tabeli. To `AuditRedactionPort` platformy, zarejestrowany jako
`auditRedactionService` obok `auditLogService`
(`packages/platform/src/kernel/ports/audit-redaction.ts`), a jego jedynym wywołującym jest proces
retencji modułu klientów.

## Encje

`AuditLogEntry` — `actorAdminUserId`, opcjonalne `impersonatedCustomerAccountId`, opcjonalne
`actorCustomerAccountId`, `action`,
`objectType`, `objectId`, `stateBefore`, `stateAfter`, `ipAddress`, `userAgent`, `requestId`,
`actedAt`. U zanonimizowanego klienta wartość w `stateBefore`, `stateAfter`, `ipAddress` lub
`userAgent` może być znacznikiem `"[erased]"`.

## Punkty rozszerzenia

- **Wysyłka do zewnętrznego systemu SIEM** — emituj zdarzenie domenowe przy każdym nowym wpisie
  audytu i pozwól integracji przekazywać strumień do Splunk, Elastic itp.
- **Okres przechowywania** — dziś wpisy nie są usuwane po upływie czasu; okres przechowywania
  określa ten, kto utrzymuje platformę. Opisane wyżej usuwanie danych dotyczy jednego klienta, przy
  anonimizacji, i nie usuwa żadnego wpisu.

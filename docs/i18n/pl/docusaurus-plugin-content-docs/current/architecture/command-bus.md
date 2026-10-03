---
title: Command Bus (jednolity audyt zapisów i cofanie zmian)
---

# Command Bus

Wrażliwe zapisy są audytowane przez **ścieżkę poleceń zapewnianą przez framework**, a nie przez
ręcznie wstawiane wywołania audytu. Wrażliwa zmiana — utworzenie, aktualizacja lub usunięcie
rekordu domenowego — wykonuje się jako nazwane **polecenie** (Command) przez `CommandBus`, który
jest jedynym, gwarantowanym autorem jej wpisu w dzienniku audytu. Usługi w modułach przeniesionych
na ten mechanizm nigdy nie wywołują zapisu audytu bezpośrednio.

## Co gwarantuje wykonanie polecenia

`commandBus.run(command)` wykonuje w **jednej** transakcji, na osobnym forku EntityManagera z
kontekstem tenanta:

1. ustala użytkownika z bieżącego `TenantContext` (z odmową w razie wątpliwości — bez kontekstu
   rzuca wyjątek, zanim cokolwiek zapisze; użytkownik nigdy nie pochodzi z treści żądania);
2. zapamiętuje stan przed zmianą, wykonuje zapis na transakcyjnym `em` i w tej samej transakcji
   zapisuje **dokładnie jeden** wpis audytu;
3. buforuje opcjonalne zdarzenie domenowe i wysyła je **raz, po zatwierdzeniu** transakcji.

Zatwierdzone polecenie zapisuje więc jeden wiersz audytu i raz emituje zdarzenie; wycofane polecenie
nie zapisuje wiersza audytu i nie emituje zdarzenia. Zapis, wpis audytu i zdarzenie nigdy nie mogą
sobie przeczyć.

## Budowa polecenia

```ts
interface Command<TResult> {
  action: string;         // dot-namespaced, e.g. 'product.update', 'credit_limit.adjust'
  objectType: string;     // e.g. 'product'
  objectId: string;
  capture?(ctx): Promise<AuditState>;                 // optional pre-state
  run(ctx): Promise<{ result: TResult; before?; after?; skipAudit? }>;
  event?(result): CommandEvent | undefined;           // dispatched once on commit
}
```

`skipAudit: true` pozwala poleceniu, które zdecydowało, że **niczego** nie zmieni, zatwierdzić
transakcję bez wiersza audytu (wynik biznesowy „nic do zrobienia”), dzięki czemu reguła „brak
zapisu ⇒ brak audytu” pozostaje prawdziwa.

## Dwie ścieżki audytu

Gwarancję pokrycia spełniają dwa dozwolone mechanizmy; oba zapisują **jeden** wpis audytu w tej
samej transakcji i ustalają użytkownika z bieżącego `TenantContext`:

- **`CommandBus.run(command)`** — zarządza własną transakcją. Używaj go, gdy zapis da się wyrazić
  jako samodzielną jednostkę pracy (to ścieżka domyślna i jedyna, która obsługuje cofanie zmian i
  buforowane zdarzenia domenowe).
- **`recordAuditFromContext(auditLog, em, input)`** — lżejsze uzupełnienie
  (`packages/platform/src/commands/audit-from-context.ts`). Zapisuje wpis audytu w `em`, którym
  wywołujący już dysponuje, a zatwierdza go istniejące wywołanie `flush()`. Używaj go, gdy zapis
  już działa we własnej transakcji albo w `persistAndFlush(...)` i nie da się go objąć transakcją
  Command Busa bez przebudowy. Użytkownik jest tu ustalany w miarę możliwości: bez kontekstu (np.
  przy samodzielnej rejestracji przed zalogowaniem albo w workerze) zapisuje puste identyfikatory
  użytkownika zamiast rzucać wyjątek, więc zapisy w tle też są audytowane. Kod, który *musi* znać
  użytkownika, używa Command Busa.

Większość zapisów w modułach korzysta z małej prywatnej metody pomocniczej
`#audit(em, action, objectId, before, after)`, delegującej do `recordAuditFromContext`, dzięki
czemu wywołanie audytu zajmuje w każdym miejscu zapisu jeden wiersz.

## Cofanie zmian

Polecenie może zapisać stan przed zmianą i po niej dla każdego rekordu, aby operator mógł je
**cofnąć**. Masowa edycja produktów przechowuje `RevertRecord[]` w `catalog_bulk_operations`;
`POST /admin/catalog/bulk-operations/:id/undo` przywraca każdy produkt, którego bieżący stan nadal
odpowiada operacji, **odrzuca każdy rekord zmieniony w międzyczasie, zgłaszając konflikt** (nigdy
nie nadpisuje go po cichu), można je bezpiecznie wywołać ponownie i samo cofnięcie też jest
audytowane. Zmiany, których nie da się cofnąć (np. zmiany powiązań kategorii), są oznaczone jako
nieodwracalne i nie oferują cofnięcia.

## Zapis audytowany a jawne wyłączenie

Nie każda zmiana jest audytowanym zdarzeniem domenowym. Zapis należy do jednej z dwóch grup:

- **Audytowany** — zainicjowana przez operatora lub klienta zmiana trwałego rekordu domenowego
  (utworzenie, aktualizacja lub usunięcie w katalogu, zamówieniach, cenach, organizacjach…),
  zdarzenie bezpieczeństwa (zmiana hasła, roli, MFA, klucz API) albo konfiguracja finansowa
  (podatki, promocje). Takie zapisy wykonują polecenie albo `recordAuditFromContext`.
- **Jawnie wyłączony** — zapis, który *nie jest* audytowanym zdarzeniem domenowym, oznaczony w
  metodzie komentarzem `command-coverage-ignore: <reason>`. Uznane kategorie, każda opisana w
  miejscu wywołania:
  - **przejściowy stan roboczy** — koszyki, listy życzeń i listy zakupów, stan kuponu w koszyku
    (trwały, audytowany rekord powstaje dopiero jako zamówienie albo zapytanie ofertowe);
  - **telemetria** — zbieranie danych analitycznych, zapisywanie fraz wyszukiwania, śledzenie
    zaangażowania;
  - **infrastruktura uwierzytelniania i sesji** — cykl życia sesji, aktualizacja
    `lastLoginAt`/`lastUsedAt` (stanem sesji zarządza `SessionService`);
  - **wysyłka, wykonanie i synchronizacja z dostawcami** — wysyłka e-maili i newslettera,
    ponawianie i dostarczanie webhooków, przyjmowanie i odwzorowywanie zdarzeń od dostawców
    Stripe, płatności i wysyłek (same *przejścia* statusu zamówienia lub płatności, które te
    zdarzenia wywołują, są audytowane w obsłudze zamówień);
  - **idempotentne uzgadnianie i dane początkowe przy starcie** — uzgadnianie ustawień, akcji,
    hooków CMS i słowników oraz domyślne dane początkowe (naprawy niezmienników systemu, a nie
    zapisy operatora).

Reguła ogólna: audytuj trwałą zmianę stanu, którą da się przypisać operatorowi; jawnie wyłączaj
zapisy przejściowe, telemetrię, infrastrukturę oraz zapisy wyprowadzone i synchronizacyjne —
zawsze tam, gdzie audytowane zdarzenie jest rejestrowane gdzie indziej, i zawsze z jednym zdaniem
uzasadnienia.

## Kontrola pokrycia (wymuszana w CI)

`scripts/check-command-coverage.ts` statycznie wskazuje — dla każdej metody **i każdego handlera
trasy**, w każdym pliku `.ts` w katalogach, w których może leżeć kod modułu (każdy pakiet modułu,
drzewo aplikacji i drzewo nakładki, wyznaczane przez `resolveModuleLayout()`) — wrażliwą zmianę
(`persist*`, `nativeUpdate`, `nativeDelete`, `remove*`, `flush`), która nie jest ani audytowana,
ani jawnie wyłączona, a także **podwójny audyt** (jednostkę, która jednocześnie wykonuje polecenie
i audytuje ręcznie). Jednostka jest uznawana za pokrytą, gdy wykonuje polecenie, definiuje literał
polecenia, zapisuje audyt (`auditLog.record`/`recordWithin`, `recordAuditFromContext` albo
rejestrator `.audit`), deleguje do takiej jednostki (`this.<runner>()`, funkcja pomocnicza na
poziomie modułu albo lokalna zmienna funkcyjna, np. `const audit = …` w pliku tras), sama jest
funkcją pomocniczą wywoływaną przez pokrytą jednostkę (delegacja wsteczna) albo ma komentarz
`command-coverage-ignore`.

### Co obejmuje

Kontrola dopasowywała kiedyś tylko `**/services/<file>.ts` — jeden poziom i nic więcej, czyli
**472 z 1152 plików modułów** w drzewie. `pim_ergonode/services/import/`,
`product_feeds/services/delivery/` i `services/queues/` leżały o poziom za głęboko;
`workers/`, `queues/`, `jobs/`, `commands/`, wszystkie pliki `routes*.ts`, wszystkie hooki startowe
w `backend.ts`, wszystkie punkty wejścia w `scripts/` i wszystkie mechanizmy uzgadniania w
`seeds/` były całkowicie poza zakresem — czyli kontrola przechodziła bez uwag akurat dla
konsumentów kolejek i handlerów tras administracyjnych, dwóch miejsc, w których naprawdę odbywają
się zapisy. Po rozszerzeniu znalazła dziesięć nieaudytowanych zapisów widocznych dla operatora
(dziewięć handlerów tras administracyjnych w siedmiu modułach i jedno tworzenie konta przy
logowaniu przez zewnętrznego dostawcę tożsamości).

Zostały cztery wyłączenia, każde uzasadnione, a nie przeoczone: `migrations/` (DDL bez żądania i
bez użytkownika), `*.test.ts` / `*.d.ts` (kod, który nie trafia do produkcji) i `audit_logs/`
(sam zapis audytu — wymaganie audytu audytu byłoby błędnym kołem). `seeds/` i `scripts/` **są**
objęte kontrolą i zamiast tego mają opisane jawne wyłączenia.

Rozszerzenie wymagało dwóch zawężeń. `remove` liczy się jako zmiana przez ORM tylko wtedy, gdy
jest wywoływane na EntityManagerze — 30 zgłoszeń z pierwszego przebiegu to było
`deps.<x>Service.remove(id)` w handlerze trasy, czyli wywołanie audytowanej usługi — natomiast
część wykrywająca nieaktualne wyłączenia nadal liczy je wszędzie. Plik tras jest też oceniany
**osobno dla każdego handlera**: oceniany jako całość, jeden `commandBus.run` w dowolnym miejscu
pliku zaliczałby wszystkie pozostałe handlery, a to jest dokładnie to maskowanie, przed którym
chroni reguła „osobno dla każdej metody”, tylko o poziom wyżej.

Wdrożenie na całej platformie jest **zakończone** — wszystkie moduły backendu zostały przeniesione
(207 zarejestrowanych akcji poleceń, ok. 120 udokumentowanych jawnych wyłączeń). CI uruchamia
kontrolę z `--strict` w etapie `quality`, więc **każde** zgłoszenie w **dowolnym** module — także
całkiem nowym — przerywa build. Pokrycie nie może się po cichu pogorszyć.

### Jawne wyłączenia są sprawdzane pod kątem aktualności

Komentarz wyłączający ma 185 metod, a kiedyś nikt go ponownie nie czytał: wyłączenie napisane dla
zapisu, który potem przeniesiono — do polecenia albo do audytowanej usługi innego modułu — nadal
zwalniało metodę, która już tego nie potrzebowała, a kolejny dodany tam zapis po cichu
dziedziczył zwolnienie. Znacznik na metodzie, która **w ogóle już niczego nie zapisuje**, jest
teraz zgłaszany jako `stale-ignore` i przerywa build, więc wyłączenia działają jak zapadka w obie
strony, tak jak każdy inny rejestr w repozytorium. Przy pierwszym uruchomieniu znaleziono cztery,
wszystkie w usługach bramek płatności, których lokalne odwzorowywanie przeniesiono do
`ReceivePaymentHandler`; ich opisy zostały jako zwykłe komentarze.

Część wykrywająca nieaktualne wyłączenia celowo szuka zapisów **szerzej** niż część zgłaszająca
— liczy też surowe instrukcje zapisu SQL, zapisy w kolejce lub w Redis (`removeJobScheduler`,
`obliterate`, `del`, …), niejednoznaczne `remove` na dowolnym obiekcie i każdy zapis osiągalny
przez wywołanie w tym samym pliku — więc znacznik chroniący prawdziwy zapis, którego sama kontrola
nie widzi, zostaje nietknięty. Oba rodzaje błędów są więc bezpieczne: w najgorszym razie znacznik
przetrwa swój zapis o jeden refaktoring dłużej, nigdy odwrotnie. Zanim można było rozszerzyć
skanowanie, trzeba było rozszerzyć tę część: `product_feeds/workers/taxonomy-refresh-worker.ts`
opisuje swoje `queue.removeJobScheduler(…)` jako „Redis-only”, a kontrola znająca tylko ORM i SQL
zażądałaby usunięcia poprawnej decyzji w chwili, gdy `workers/` weszły w zakres.

Znacznik musi też znajdować się **na** jednostce, którą wyłącza: w jej treści albo w komentarzu
dokumentującym bezpośrednio nad nią. Cztery pliki poleceń opisują politykę swojego modułu w
nagłówku pliku, który cytuje ten token, a odczytywanie wszystkich komentarzy poprzedzających
jednostkę pozwalało temu nagłówkowi wyłączyć tę deklarację, która akurat była pierwsza — a potem,
po wprowadzeniu sprawdzania aktualności, zgłaszać ją jako martwy znacznik, którego nikt nie
napisał.

## Przenoszenie zapisu na ten mechanizm

Dla polecenia: wydziel sam zapis tak, by działał na transakcyjnym `em`, i wykonaj go przez
`commandBus.run(...)`; w tej samej zmianie usuń wcześniejsze ręczne wywołanie audytu (aby nie
powstał podwójny audyt). Dla lżejszej ścieżki: dodaj metodę pomocniczą `#audit(...)` delegującą do
`recordAuditFromContext` i wywołaj ją tuż przed `flush()` metody. Dla zapisu, który nie podlega
audytowi: dodaj komentarz `command-coverage-ignore: <reason>`.

**Nigdzie nie trzeba rejestrować akcji.** Wcześniej ten akapit kończył się zdaniem *„zarejestruj
każdą nową akcję polecenia w `backend/src/commands/command-registry.ts`”*, a nagłówek tamtego pliku
wymieniał dwóch odbiorców listy — tę kontrolę i funkcje cofania dla operatora. Oba stwierdzenia
były błędne od dnia napisania: `check-command-coverage.ts` nigdy go nie importował i o pokryciu
decyduje na podstawie wywołania `commandBus.run(...)` w tej samej metodzie, a jedyna funkcja
cofania w drzewie odczytuje **kolumnę** `reversible` w `catalog_bulk_operations`, ustawianą dla
każdego wiersza, gdy operacja zapisała stan do przywrócenia. `CommandBus.run` nigdy z tej listy
nie korzystał, a `Command.action` to zwykły `string`. Ręcznie utrzymywana lista 258 dozwolonych
wpisów wyglądała więc jak zabezpieczenie, a niczego nie zabezpieczała — co jest gorsze niż brak
listy: następny autor pytający *„czy ten zapis jest pokryty?”* dostawał od niej pewną siebie, błędną
odpowiedź. Została usunięta. **`action` polecenia to dowolny string, który polecenie deklaruje**;
o tym, że zapis jest audytowany, decyduje to, że przechodzi przez `CommandBus.run`, a sprawdza to
wyłącznie kontrola opisana powyżej.

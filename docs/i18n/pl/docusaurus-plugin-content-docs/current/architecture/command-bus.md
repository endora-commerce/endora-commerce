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
  hookData?(result): unknown;                         // required when the action is hookable
  outboxData?(result): OutboxData;                    // afterCommit data, ids and codes only
  extensions?: Record<string, unknown>;               // caller input for hook modules, by module id
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
  w workerze, który go nie otworzył) zapisuje puste identyfikatory użytkownika zamiast rzucać
  wyjątek, więc zapisy w tle też są audytowane. Kod, który *musi* znać użytkownika, używa Command
  Busa. Żądanie anonimowe nie jest takim przypadkiem: ma kontekst systemowy, więc zapis przed
  zalogowaniem, na przykład samodzielna rejestracja w storefroncie, działa jako polecenie
  (`organization.register`) z pustym użytkownikiem.

Większość zapisów w modułach korzysta z małej prywatnej metody pomocniczej
`#audit(em, action, objectId, before, after)`, delegującej do `recordAuditFromContext`, dzięki
czemu wywołanie audytu zajmuje w każdym miejscu zapisu jeden wiersz.

## Co zawiera wpis audytu

Dziennik audytu to jedna tabela całej platformy, czytana z jednym uprawnieniem
(`audit_log:read`) bez względu na to, które Organizacje czytający widzi. Dlatego dla **rekordu
o zakresie dzierżawcy** (encji `@OrgScoped`, `@CustomerScoped`, `@TransitivelyScoped` lub
`@RuleScoped`) stan przed i po zapisany przez polecenie zawiera **nazwy i strukturę, nigdy
wartości**: identyfikatory, numery dokumentów, kody statusów i inne kody, wartości logiczne,
liczniki, daty oraz `changedFields` / `changedCustomFields`, czyli listę tego, co się zmieniło.
Tytuły, opisy, kwoty, wartości pól własnych, dane osobowe ani identyfikator Organizacji lub Konta
klienta, do którego rekord należy, do niego nie trafiają. Moduł, którego historia rekordu pokazuje
wartości, trzyma je we własnym magazynie, zapisywanym w tym samym poleceniu i czytanym wyłącznie
przez ścieżkę dostępu rekordu z jego zakresem; wpis audytu wskazuje ten wiersz przez
`valueChangeId`. Rekordy globalne platformy (katalog, ustawienia, słowniki) nadal mogą zapisywać
wartości. Regułę i obowiązek testowy opisuje w repozytorium `specs/conventions/audit-state.md`
(zgłoszenie #470).

## Haki poleceń (`beforeCommit`) {#command-hooks-beforecommit}

Moduł może brać udział w **zapisie innego modułu** bez jego forkowania, ale tylko w zapisie, który
moduł-właściciel otworzył dla haków. Właściciel **deklaruje** akcję polecenia jako dostępną dla
haków: publikuje typowaną referencję w `@endora-commerce/contracts` i wymienia ją w
`hookableActions` swojego manifestu. `organizations` deklaruje cztery (zob. stronę modułu). Każdy
moduł — moduł rdzenia, moduł nakładki wdrożenia albo zainstalowany pakiet — rejestruje wtedy hak:

```ts
import { ORGANIZATION_HOOKABLE_ACTIONS as ORG } from '@endora-commerce/contracts';
import { CommandHookRefusal } from '@endora-commerce/platform/commands';

export function registerModule(ctx: ModuleContext): void {
  ctx.commandHooks([
    {
      id: 'refuse-unserved-country',
      on: ORG.register,
      phase: 'beforeCommit',
      handler: ({ data }) => {
        if (!SERVED.has(data.organization.registeredAddress.country)) {
          throw new CommandHookRefusal(409, ACME_COUNTRY_NOT_SERVED, 'We do not serve this country.');
        }
      },
    },
  ]);
}
```

**Kiedy działa.** Wewnątrz transakcji polecenia, po `run` właściciela i przed jego wpisem audytu:
`capture → run → haki → wpis audytu → zdarzenie → commit`. Hak dostaje zadeklarowane przez
właściciela `data` (typowane przez referencję, odzwierciedlające niezatwierdzony zapis), to samo
`em` i tego samego aktora oraz `ctx.run(child)`, by uruchomić w tej samej transakcji własne
polecenie albo polecenie innego właściciela, z jego własnym wpisem audytu.

**Weto.** Hak odmawia, rzucając `HttpError` z kodem, który jego moduł deklaruje i tłumaczy
(`CommandHookRefusal` to czytelniejsza podklasa). Całe polecenie jest wycofywane — wiersz
właściciela, każde polecenie potomne, każdy wpis i zdarzenie — a wywołujący dostaje ten status i
kod. Każdy inny wyjątek również wycofuje zapis i daje odpowiedź `500`.

**To, co hak zapisał, jest nazwane w jedynym wpisie właściciela.** Hak zapisujący własne tabele
wywołuje `ctx.noteAuditChanges(['x_acme_erp_code'])`, a wpis właściciela dostaje
`stateAfter.extensions.<moduleId>.changedFields`. Tylko nazwy: szyna odrzuca wszystko, co nie jest
nazwą pola, więc reguła „nazwy, nie wartości” w audycie obowiązuje także haki. Zgłoszone zmiany
wymuszają wpis: jeśli właściciel odpowiedział `skipAudit`, a hak zgłosił zapis, wpis i tak powstaje,
z `stateBefore: null` i `stateAfter: { extensions }`.

**Dane rozszerzeń.** Wywołujący może przekazać w poleceniu `extensions: { <moduleId>: … }`. Każdy
hak widzi tylko fragment własnego modułu jako `ctx.extension` i sam go waliduje. Klucz, którego nie
przejmuje żaden obecny moduł z hakiem na tej akcji, jest odrzucany kodem
`422 COMMAND_EXTENSION_UNCLAIMED`, zanim cokolwiek zostanie zapisane, więc literówka albo wyłączony
moduł nigdy nie gubią danych po cichu. `currentCommandHookOrigin()` mówi kodowi na ścieżce
asynchronicznej haka, który hak właśnie działa.

**Wyłączony znaczy wyłączony.** Hak, którego moduł jest wyłączony — na dowolnej z dwóch osi
obecności — jest pomijany dla danego polecenia; decyzja zapada przy każdym wywołaniu, bez
restartu. Zapis zachowuje się tak, jakby modułu nie zainstalowano.

**Kompozycja odrzuca to, czego nie da się uporządkować albo co nie jest oferowane.** Przy starcie,
po rejestracji wszystkich modułów i przed jakimkolwiek hakiem startowym, platforma odrzuca: hak na
akcji, której nie deklaruje żaden moduł; fazę, której właściciel nie oferuje; jedną akcję
zadeklarowaną przez dwa moduły; powtórzony identyfikator haka w module; moduł z hakiem, którego
`dependencies` w manifeście nie sięgają właściciela; oraz dwa moduły z hakami na jednej akcji bez
ścieżki zależności między nimi. Haki działają w kolejności zależności (moduł po każdym module, od
którego zależy; haki jednego modułu w kolejności rejestracji). Gdy dwa moduły są niezależne,
kolejność ustala wdrożenie w swoim `divergence.ts`:

```ts
commandHookOrder: { 'organization.register': ['acme_erp', 'acme_crm'] }, // first runs first
```

Wpis sprzeczny z zależnością jest odrzucany. Haki pojawiają się w raporcie rozbieżności wdrożenia
jako `command-hook`, a `GET /api/v1/admin/command-hooks` (za uprawnieniem `platform.modules.read`)
zwraca bieżący plan wykonania.

**Zasady dla autorów haków.** Zapisuj tylko tabele własnego modułu albo uruchamiaj polecenie
właściciela przez `ctx.run` — nigdy tabelę innego modułu. Nie wywołuj usług zdalnych: transakcja
jest otwarta, a wolny hak trzyma blokady wierszy właściciela. Hak zagnieżdżający polecenia, które
powtarzają się we własnym łańcuchu, albo zagnieżdżający głębiej niż osiem poziomów, jest
odrzucany kodem `500 COMMAND_HOOK_CYCLE`.

**Zasady dla właścicieli.** Deklaruj tylko polecenie, którego `run` jest kompletny i które nie jest
odwracalne (cofnięcie przywraca tylko to, co zapisał właściciel). Dostarcz `hookData` — szyna
odrzuca polecenie z hakami bez niego (`500 COMMAND_HOOK_DATA_MISSING`) — oraz `outboxData` dla fazy
`afterCommit` i sprawdzaj każde zadeklarowane polecenie wobec jego referencji funkcją
`expectHookableCommand` z `@endora-commerce/test-kit/command-hooks`. Nazwa akcji, fazy i typy danych
są publicznym kontraktem.

Procedury `afterCommit` są zadeklarowane w API, ale jeszcze nie są dostarczane: ich transakcyjny
outbox to następny etap tej pracy, a dopóki go nie ma, platforma odmawia rejestracji takiej
procedury, zamiast przyjąć coś, czego nic nie wywoła.

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

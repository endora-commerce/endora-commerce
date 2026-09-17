---
title: Command Bus (ujednolicone audytowanie zapisów i cofanie)
---

# Command Bus

Wrażliwe zapisy są audytowane przez **ścieżkę poleceń na poziomie frameworka**, a nie przez
ręcznie wstawione wywołania audytu (Zasada XIII Konstytucji, feature `054`). Wrażliwa
mutacja — utworzenie/aktualizacja/usunięcie rekordu domenowego — działa jako nazwane **Command**
przez `CommandBus`, który jest jedynym, gwarantowanym autorem wpisu audytu.
Serwisy w zmigrowanych modułach nigdy nie wołają pisarza audytu bezpośrednio.

## Co gwarantuje uruchomienie Command

Uruchomienie `commandBus.run(command)` wykonuje, w **jednej** transakcji scoped-fork:

1. rozwiązuje aktora z ambientowego `TenantContext` (fail-closed — brak context ⇒
   rzuca przed jakimkolwiek zapisem; aktor nigdy nie pochodzi z body żądania);
2. rejestruje stan przed, wykonuje zapis na transakcyjnym `em` i zapisuje
   **dokładnie jeden** wpis audytu współtransakcyjnie;
3. buforuje opcjonalne zdarzenie domenowe i dyspozytuje je **raz po commit**.

Commit command zapisuje jeden wiersz audytu i emituje zdarzenie raz; rollback command
nie zapisuje wiersza audytu i nie emituje zdarzenia. Zapis, wpis audytu i
zdarzenie nigdy nie mogą się rozjechać.

## Anatomia Command

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

`skipAudit: true` pozwala command, który zdecydował **nie** mutować, commitować bez
wiersza audytu (wynik biznesowy no-op), utrzymując uczciwe „brak zapisu ⇒ brak audytu”.

## Dwie ścieżki audytu

Dwa sankcjonowane mechanizmy spełniają gwarancję pokrycia; oba zapisują **jeden**
współtransakcyjny wpis audytu i wyprowadzają aktora z ambientowego `TenantContext`:

- **`CommandBus.run(command)`** — posiada własną transakcję scoped-fork. Użyj, gdy
  zapis da się wyrazić jako samodzielna jednostka pracy (domyślnie i
  jedyna ścieżka wspierająca odwracalność/cofanie i buforowane zdarzenia domenowe).
- **`recordAuditFromContext(auditLog, em, input)`** — lekki towarzysz
  (`packages/platform/src/commands/audit-from-context.ts`). Zapisuje wpis audytu na
  `em`, który wywołujący już posiada, commitowany przez istniejący `flush()` wywołującego. Użyj,
  gdy zapis już działa we własnej transakcji lub `persistAndFlush(...)` i
  nie da się owinąć transakcji busa bez restrukturyzacji. Aktor jest tu
  best-effort: bez ambient context (np. self-registration przed auth albo
  ścieżka workera) zapisuje null actor ids zamiast rzucać, więc zapisy w tle
  nadal są audytowane. Wywołujący, którzy *muszą* mieć aktora, używają busa.

Większość zapisów modułu używa małego prywatnego helpera `#audit(em, action, objectId, before, after)`
delegującego do `recordAuditFromContext`, utrzymując wywołanie audytu w jednej linii przy
każdym miejscu zapisu.

## Odwracalność i cofanie

Command może rejestrować stan przed/po per rekord, aby operator mógł go **cofnąć**.
Masowa edycja produktów (feature `022`) przechowuje `RevertRecord[]` na
`catalog_bulk_operations`; `POST /admin/catalog/bulk-operations/:id/undo` przywraca każdy
produkt, którego bieżący stan nadal pasuje do operacji, **odmawia każdego rekordu zmienionego
od tego czasu z raportem konfliktu** (nigdy cichego nadpisania), jest bezpieczny idempotentnie przy
ponownym wywołaniu i audytuje samo cofnięcie. Nieodwracalne edycje (np. zmiany mostu kategorii)
są oznaczone jako nieodwracalne i nie oferują cofnięcia.

## Audytowany zapis vs. escape hatch

Nie każda mutacja to audytowane zdarzenie domenowe. Zapis klasyfikuje się jako:

- **Audytowany** — inicjowana przez operatora lub klienta zmiana trwałego rekordu domenowego
  (create/update/delete katalogu/zamówień/cen/organizacji/…), zdarzenie bezpieczeństwa
  (hasło/rola/MFA, klucz API) albo konfiguracja finansowa (podatek, promocja). Te uruchamiają
  Command albo `recordAuditFromContext`.
- **Escape-hatched** — zapis, który *nie jest* audytowanym zdarzeniem domenowym, oznaczony komentarzem
  `command-coverage-ignore: <reason>` wewnątrz metody. Rozpoznane kategorie,
  każda udokumentowana w miejscu wywołania:
  - **przejściowy stan roboczy** — koszyki, listy życzeń/listy zakupów, stan kuponu koszyka
    (wynikowe zamówienie/RFQ rejestruje audytowany trwały rekord);
  - **telemetria** — ingest analityki, rejestrowanie fraz wyszukiwania, śledzenie zaangażowania;
  - **infrastruktura auth/sesji** — cykl życia sesji, księgowanie `lastLoginAt`/`lastUsedAt`
    (stan sesji należy do `SessionService`);
  - **dostarczanie/wykonanie i sync dostawcy** — wysyłka e-mail/newsletter, replay/delivery webhooków,
    ingest i mirroring zdarzeń Stripe/płatności/wysyłki (same *przejścia* statusu zamówienia/płatności,
    które one napędzają, są audytowane w flow zamówień);
  - **idempotentne reconcilery/seedy przy starcie** — reconcilery settings/actions/CMS-hook/słowników
    i domyślne seedy (naprawy niezmienników systemowych, nie zapisy operatora).

Reguła kciuka: audytuj trwałą, przypisywalną operatorowi zmianę stanu; escape-hatch
zapisy przejściowe, telemetrię, infrastrukturę i derived/sync — zawsze tam, gdzie
audytowane zdarzenie jest rejestrowane gdzie indziej, i zawsze z jednolinijkowym powodem.

## Sprawdzenie pokrycia (wymuszane w CI)

`scripts/check-command-coverage.ts` statycznie flaguje, per metoda **i per handler trasy**,
w każdym pliku `.ts` pod `src/modules/` i `src/apps/`, wrażliwą mutację
(`persist*`, `nativeUpdate`, `nativeDelete`, `remove*`, `flush`), która nie jest ani audytowana,
ani escape-hatched, oraz kształt **podwójnego audytu** (jednostka, która jednocześnie uruchamia Command i
audytuje ręcznie). Jednostka liczy się jako pokryta, gdy uruchamia Command, definiuje literał Command,
rejestruje audyt (`auditLog.record`/`recordWithin`, `recordAuditFromContext` albo rejestrator `.audit`),
deleguje do takiej jednostki (`this.<runner>()`, helper modułowy albo
lokalna funkcja jak `const audit = …` w pliku trasy), sama jest helperem
wołanym przez pokrytą jednostkę (delegacja wsteczna), albo ma komentarz `command-coverage-ignore`.

### Co otwiera (issue #122)

Chodzenie dopasowywało `**/services/<file>.ts` — jeden poziom, nic więcej, czyli **472
z 1152 plików modułowych drzewa**. `pim_ergonode/services/import/`,
`product_feeds/services/delivery/` i `services/queues/` były poziom za głęboko;
`workers/`, `queues/`, `jobs/`, `commands/`, każdy `routes*.ts`, każdy hook startu `backend.ts`,
każdy entry point `scripts/` i każdy reconciler `seeds/` były poza zakresem
— check czytał czysto nad konsumentami kolejek i handlerami tras admin, dwoma miejscami,
gdzie zapisy faktycznie żyją. Poszerzenie znalazło dziesięć nieaudytowanych
zapisów widocznych dla operatora (dziewięć handlerów tras admin w siedmiu modułach, jedno utworzenie konta federated sign-in).

Cztery wykluczenia pozostają, każde jako argument, nie pominięcie: `migrations/` (DDL bez
żądania i aktora), `*.test.ts` / `*.d.ts` (kod niewysyłany) i `audit_logs/` (sam
pisarz audytu — wymaganie audytu audytu jest cykliczne). `seeds/` i
`scripts/` są **w** zakresie i niosą pisane escape hatches zamiast tego.

Dwa zawężenia opłaciły poszerzenie. `remove` liczy się jako mutacja ORM tylko z
EntityManager — 30 z pierwszych findingów to było `deps.<x>Service.remove(id)` w handlerze
trasy, wywołanie do audytowanego serwisu — podczas gdy połowa staleness nadal liczy go
wszędzie. Plik trasy oceniany jest **per handler**: czytany jako jedna jednostka, jeden
`commandBus.run` gdziekolwiek w nim czyści każdy inny handler, co jest maskowaniem, przed którym
reguła per-metoda istnieje, o jeden poziom wyżej.

Rollout platformowy jest **zakończony** — wszystkie moduły backendu są zmigrowane (207
zarejestrowanych akcji command, ~120 udokumentowanych escape hatches). CI uruchamia check z
`--strict` w etapie `quality`, więc **każdy** finding w **dowolnym** module — w tym
zupełnie nowym — psuje build. Pokrycie nie może cicho regresować.

### Escape hatch jest przeszukiwany pod kątem staleness

185 metod ma komentarz ignore, i do issue #116 nic go nie czytało ponownie: ignore
napisany dla zapisu, który od tego czasu się przeniósł — do Command albo do audytowanego
serwisu innego modułu — nadal zwolniał metodę, która już nie potrzebowała zwolnienia,
a następny zapis dodany tam dziedziczył zwolnienie w ciszy. Marker na metodzie,
która **w ogóle już nie zapisuje**, jest teraz raportowany jako `stale-ignore` i psuje build,
więc hatch jest dwukierunkowym grzybem jak każdy inny ledger w repozytorium. Cztery
znaleziono przy pierwszym przebiegu, wszystkie w serwisach bramek płatności, których lokalne
mirrorowanie przeniosło się do `ReceivePaymentHandler`; ich proza została jako zwykłe komentarze.

Połowa staleness celowo szuka zapisów **szerzej** niż połowa flagowania —
liczy też surowe SQL, zapis kolejki lub Redis (`removeJobScheduler`,
`obliterate`, `del`, …), niejednoznaczne `remove` z dowolnego odbiorcy i każdy zapis osiągalny
przez wywołanie w tym samym pliku — więc marker strzegący prawdziwego zapisu, którego check sam
nie widzi, zostaje w spokoju. Oba błędy padają po bezpiecznej stronie: w najgorszym razie marker
przeżyje swój zapis jeszcze jeden refactor, nigdy odwrotnie. Poszerzenie skanu (issue
#122) musiało najpierw poszerzyć tę połowę: `product_feeds/workers/taxonomy-refresh-worker.ts`
dokumentuje swój `queue.removeJobScheduler(…)` jako „Redis-only”, a sweep znający tylko
ORM i SQL zażądałby usunięcia poprawnej decyzji w momencie, gdy `workers/`
weszły w zakres.

Marker musi też **leżeć na** jednostce, którą zwalnia: wewnątrz body albo w komentarzu doc
bezpośrednio nad nią. Cztery pliki command opisują politykę modułu w nagłówku pliku, który
cytuje token, a czytanie pełnej wiodącej trivia jednostki pozwalało temu nagłówkowi zwolnić
deklarację, która akurat była pierwsza — potem, gdy sweep wylądował, raportował go jako martwy
marker, którego nikt nie pisał.

## Konwersja zapisu

Dla Command: wyciągnij czysty zapis na transakcyjny `em` i uruchom przez
`commandBus.run(...)`; usuń wcześniejsze ręczne wywołanie audytu w tej samej zmianie (unikaj kształtu
podwójnego audytu). Dla lekkiej ścieżki: dodaj helper `#audit(...)` delegujący
do `recordAuditFromContext` i wołaj go tuż przed `flush()` metody. Dla
nieaudytowanego zapisu: dodaj komentarz `command-coverage-ignore: <reason>`. Pełny wzorzec jest w
quickstartcie feature (`specs/054-command-bus-audit-undo/quickstart.md`).

**Nie ma akcji do rejestracji nigdzie** (D-163). Do tej pory akapit kończył się
*„zarejestruj każdą nową akcję Command w `backend/src/commands/command-registry.ts`”*,
a nagłówek tego pliku nazywał dwóch konsumentów listy — ten check i operatorowe
affordance cofania. Obaj byli błędni od dnia napisania: `check-command-coverage.ts`
nigdy go nie importował i decyduje o pokryciu z wywołania `commandBus.run(...)` w tej samej
metodzie, a jedyne affordance cofania w drzewie czyta kolumnę `reversible` na
`catalog_bulk_operations`, ustawianą per wiersz, gdy operacja zarejestrowała stan revert.
`CommandBus.run` nigdy go nie konsultował, a `Command.action` to zwykły `string`. Ręcznie utrzymywana
lista allow 258 wpisów wyglądała jak brama na Zasadę XIII i nie bramkowała niczego, co
gorsze niż brak listy: następny autor pytający *„czy ten zapis jest pokryty?”* dostał pewną
złą odpowiedź. Usunięto ją. **`action` Command to dowolny string, który Command deklaruje**;
co czyni zapis audytowanym, to że działa przez `CommandBus.run`, a jedyne, co to sprawdza, to
check opisany powyżej.

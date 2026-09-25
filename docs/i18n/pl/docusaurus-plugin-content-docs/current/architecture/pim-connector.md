---
title: Wspólna warstwa łącznika PIM
---

# Wspólna warstwa łącznika PIM (`pim_connector`)

Moduł, który trzyma zachowanie potrzebne **każdemu** przychodzącemu łącznikowi PIM,
bez importu jakiegokolwiek transportu dostawcy. Jest dostarczany z Endorą, jest
`nonDeactivatable` i nie zawiera w ogóle kodu dostawcy: łącznik PIM to osobny pakiet,
a wdrożenie może zainstalować żaden, jeden albo kilka z nich.

Ta strona jest dla inżyniera piszącego lub recenzującego łącznik PIM oraz dla każdego,
kto pyta, jak dwa łączniki współistnieją na jednej platformie. Własny transport
łącznika, ekrany mapowań i pipeline importu dokumentuje pakiet tego łącznika.

## Co posiada

| Troska | Gdzie żyje |
| --- | --- |
| Klucz możliwości `pim-connector` i deklaracja, że wyklucza się wzajemnie | `exclusiveCapabilities` we własnym `manifest.ts` tego modułu |
| Jedyny szew wyłączności, nad wyprowadzoną rodziną | interceptor `pre` w `src/backend/index.ts` |
| Który członek trzyma roszczenie | `PimConnectorRegistryService`, `pim_connector_activation_lock` |
| Kod odmowy `PIM_CONNECTOR_ALREADY_ACTIVE` i jego zdanie dla operatora | `errorCodes` manifestu, `i18n/{en,pl}.json` |
| Wspólna gramatyka ścieżek ochrony pól | `canonicalisePimFieldPath()` w `packages/contracts/src/pim-field-path.ts` |
| Słownik kontraktu dla runów, issue, triggerów, trybów i liczników | `packages/contracts/src/pim-connector.ts` |
| Kod admin | nic — patrz poniżej |

**Nie** posiada zapisów katalogu, faz importu, klientów dostawcy ani ingressu
webhooków. To zostaje w każdym pakiecie łącznika.

**I nie posiada kodu admin**, co jest korektą, a nie pominięciem. Współdzielony badge
statusu runu i lista issue kiedyś leżały pod `admin/src/modules/pim_connector/`,
a późniejszy pomiar wykazał, że katalog miał jednego konsumenta, więc oba pliki
przeniesiono do własnego pakietu tego łącznika, obok ekranów, które je renderują.
Pakiet modułu nie może w ogóle wskazywać `admin/src`, więc współdzielony komponent
admin potrzebuje *opublikowanego* domu — kitu projektowego albo wspieranego subpath
tego pakietu — i żaden jeszcze nie istnieje, bo jeden konsument go nie potrzebuje.
Drugi łącznik chcący tego chrome to moment, który by go kupił.

## Rodzina jest deklarowana, nigdy wyliczana

Łącznik dołącza do rodziny we **własnym** manifeście:

```ts
capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
```

Platforma wyprowadza członkostwo z tych deklaracji przy każdym komponowaniu —
`effectiveState.membersOfCapability(key)` dla członków skutecznie obecnych,
`declaredMembersOfCapability(key)` dla samego członkostwa. **Nic w tym repozytorium
nie trzyma listy łączników.**

To celowe, i to feature 132 jest powodem. Lista członków była kiedyś ręcznie pisaną
tablicą w `@endora-commerce/contracts` i wymieniała dwa z ówcześnie dostarczanych
łączników — więc wykluczenie obejmowało jedną szóstą uporządkowanych par i nic tego
nie mówiło, łącznik zainstalowany z npm w ogóle nie mógł do niej dołączyć, a moduł
overlay per wdrożenie musiał w tym celu edytować plik core. Wyprowadzone z deklaracji,
łącznik deklarujący członkostwo jest objęty **przez samo istnienie**, a łącznik, który
przestaje je deklarować, opuszcza rodzinę, zamiast zostawiać po sobie przechodzącą
asercję.

Członek **nie musi** zależeć od `pim_connector`, żeby być objętym: szew należy do
właściciela. Deklaruj zależność tylko wtedy, gdy łącznik sam rozwiązuje port rejestru.
Wdrożenie, które instaluje łącznik *bez* tej wspólnej warstwy, ma rodzinę, która po
prostu nie jest tam wyłączna — nie ma wiersza lock i nie ma czym egzekwować.

## Wykluczanie wzajemne

Endora pozwala mieć **zainstalowanych** kilka pakietów łącznika PIM, ale operator może
mieć **co najwyżej jeden aktywny** naraz. Sześć właściwości szwu jest nośnych:

- **Jeden szew, rejestrowany przez właściciela.** Interceptor `pre` na
  `POST /api/v1/admin/modules/:id/activation`, rejestrowany raz przez `pim_connector`
  nad wyprowadzoną rodziną. Członek **nie może** rejestrować własnego interceptora
  wyłączności ani ręcznie implementować tego sprawdzenia gdziekolwiek indziej — w ten
  sposób nowy łącznik został kiedyś dostarczony bez żadnego egzekwowania.
- **Skuteczna obecność, nigdy samo Setting aktywacji.** Dostępność platformowa ORAZ
  aktywacja operatora — koniunkcja, którą liczy `effectiveState`. Moduł, którego
  wdrożenie nigdy nie zainstalowało, nie trzyma roszczenia (Zasada XVII).
- **Odmowa zapada, zanim uruchomi się audytowana Command**, więc odmówiona aktywacja
  niczego nie zapisuje.
- **Dezaktywacja nigdy nie jest odmawiana.** Członka zawsze można wyłączyć.
- **Ponowna aktywacja posiadacza nie jest odmawiana.** Trasa jest idempotentna, więc
  moduł, który już trzyma roszczenie, jest wyłączony z szukania rywala.
- **Dwa różne klucze możliwości nigdy się nie wykluczają.** Jeden łącznik PIM, jeden
  łącznik ERP i jeden dostawca księgi faktur mogą być aktywne jednocześnie.

Odmowa to `409 PIM_CONNECTOR_ALREADY_ACTIVE` ze szczegółami
`{ activeModuleId: <posiadacz> }`. Zdanie dla operatora jest interpolowane po stronie
klienta z tego id, więc komunikat nazywa moduł-posiadacza tak, jak robi to ekran
modułów, a nie po jego id.

`pim_connector` subskrybuje też `module.activation.changed` i zapisuje albo czyści
wiersz lock. Interceptor sam nigdy nie persystuje stanu, a subskrybent sprawdza
członkostwo **zadeklarowane**, bo przy dezaktywacji członek jest już nieobecny, a test
skutecznej obecności odrzuciłby dokładnie to zdarzenie, które musi wyczyścić lock.

### Na świeżej instalacji żaden łącznik nie jest aktywny

Żaden członek nie może deklarować `activation.default: true`. Jest to odrzucane przy
wyprowadzaniu, z nazwą modułu, i asertuje to statyczny check. Powodem nie jest
porządek: wykluczenie rozstrzyga się na osi aktywacji, a resolver nie zwraca
pochodzenia, więc członek aktywowany domyślnie trzymałby roszczenie, którego nikt nie
zgłosił — a wykluczanie wzajemne nie może zawodzić w stronę otwartą. Ograniczenie tego
do „jeden członek może” zostawia ten błąd kategorii na miejscu.

Stockowa instalacja nie ma więc aktywnego łącznika PIM, a operator wybiera jeden na
`/platform/modules`. Zmiana dostarczanej wartości domyślnej nigdy nie nadpisuje
zapisanego wyboru: wartość domyślna stosuje się tylko tam, gdzie wiersz Setting nie
niesie nadpisania, i **żadna migracja nie może zapisać wiersza aktywacji**.

Przełączanie łączników jest **niedestrukcyjne**. Wiersze zaimportowane przez poprzedni
łącznik zostają w katalogu, a połączenie, mapowania, ochrony i historia runów każdego
łącznika są zachowane i wracają niezmienione, gdy zostanie on ponownie włączony.

## Ścieżki ochrony pól

Łącznik, który pozwala administratorowi chronić lokalnie kuratorowaną wartość przed
nadpisaniem przy imporcie, współdzieli **gramatykę ścieżek**, więc kontrolki admin
i walidacja pozostają identyczne między łącznikami:

```text
attribute.<key>[.<locale>]
attribute.<key>.<channel-uuid>[.<locale>]
seo.(metaTitle|metaDescription|metaKeywords).<locale>
gallery.<index>
attachment.<asset-uuid>
price.<price-list-uuid>.<currency>
category.<category-uuid>
name[.<locale>]
description[.<locale>]
```

`canonicalisePimFieldPath()` normalizuje segmenty — wielkość liter locale do `ll_RR`,
UUID do małych liter, walutę do wielkich — i zwraca `null` dla wszystkiego poza
gramatyką. Serwis ochrony pól łącznika woła go przed zapisem wiersza ochrony,
a `isValidPimFieldPath()` to ten sam osąd w postaci predykatu.

## Pisanie łącznika

1. **Zadeklaruj członkostwo**: `capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR]`
   w manifeście. To całe dołączenie do rodziny.
2. **Zadeklaruj przełącznik operatora**: blok `activation`, którego `settingCode`
   wskazuje boolowskie Setting, z `default: false`. Nigdy `true`.
3. **Nie** rejestruj interceptora aktywacji i nie zgłaszaj
   `PIM_CONNECTOR_ALREADY_ACTIVE` — kod należy do właściciela, a członek, który go
   deklaruje, jest odrzucany.
4. **Użyj ponownie** `canonicalisePimFieldPath()` dla przełączników ochrony w edytorze
   produktu oraz schematów statusu runu, severity issue, triggera, trybu i liczników
   z `packages/contracts/src/pim-connector.ts` — to utrzymuje listy runów i badge
   spójne między łącznikami.
5. **Nie** importuj pakietu innego łącznika. Współdzielony kod należy tutaj albo do
   `packages/contracts`.

## Gdzie leży kod

```text
packages/modules/pim_connector/
├── package.json                generated — never hand-written
├── i18n/{en,pl}.json
└── src/
    ├── manifest.ts
    ├── migrations/
    └── backend/
        ├── index.ts            registerModule, the seam, the subscriber, entities
        ├── entities/pim-connector-activation-lock.entity.ts
        └── services/
            ├── pim-connector-registry.service.ts
            └── registry.test.ts

packages/contracts/src/pim-connector.ts
packages/contracts/src/pim-field-path.ts
backend/test/{unit,contract,integration}/pim_connector/
```

## Bramki

```bash
pnpm --filter @endora-commerce/mod-pim-connector run test
pnpm --filter backend exec vitest run test/unit/pim_connector test/contract/pim_connector \
  test/integration/pim_connector
```

`test/integration/pim_connector/exclusivity-pairs.test.ts` przechodzi przez **każdą
uporządkowaną parę** wyprowadzonej rodziny i niesie strażnika, że wyliczona rodzina
nie była pusta — `describe.each([])` nie uruchamia niczego, i tak właśnie wersja tego
zestawu sterowana listą pozostawała zielona nad parami, o których nie wiedziała.

## Powiązane lektury

- [Referencja modułu `pim_connector`](../module-reference/pim-connector.md) —
  uprawnienia, ustawienia, aktywacja i zależności deklarowane przez manifest tego modułu.
- [Cykl życia modułu](../modules/lifecycle.md) — trasa aktywacji, którą przechwytuje
  szew wyłączności.

---
title: Wspólna warstwa konektorów PIM
---

# Wspólna warstwa konektorów PIM (`pim_connector`)

Moduł, który zawiera zachowanie potrzebne **każdemu** konektorowi PIM importującemu dane do
platformy, bez importowania transportu żadnego dostawcy. Jest dostarczany z Endorą, jest
`nonDeactivatable` i w ogóle nie zawiera kodu dostawcy: konektor PIM to osobny pakiet, a wdrożenie
może zainstalować żaden, jeden albo kilka.

Ta strona jest przeznaczona dla inżyniera, który pisze lub recenzuje konektor PIM, oraz dla
każdego, kto chce wiedzieć, jak dwa konektory współistnieją w jednej platformie. Transport, ekrany
mapowań i proces importu konkretnego konektora dokumentuje jego własny pakiet.

## Za co odpowiada

| Obszar | Gdzie się znajduje |
| --- | --- |
| Klucz możliwości `pim-connector` i deklaracja, że wyklucza się wzajemnie | `exclusiveCapabilities` we własnym `manifest.ts` tego modułu |
| Jedyny punkt egzekwowania wyłączności, działający na wyprowadzonej rodzinie | interceptor `pre` w `src/backend/index.ts` |
| Który członek rodziny jest aktywny | `PimConnectorRegistryService`, `pim_connector_activation_lock` |
| Kod odmowy `PIM_CONNECTOR_ALREADY_ACTIVE` i jego komunikat dla operatora | `errorCodes` w manifeście, `i18n/{en,pl}.json` |
| Wspólna składnia ścieżek ochrony pól | `canonicalisePimFieldPath()` w `packages/contracts/src/pim-field-path.ts` |
| Słownictwo kontraktu dla przebiegów, problemów, wyzwalaczy, trybów i liczników | `packages/contracts/src/pim-connector.ts` |
| Kod panelu administracyjnego | nic — zobacz niżej |

**Nie** odpowiada za zapisy w katalogu, etapy importu, klientów dostawców ani odbiór webhooków. To
wszystko pozostaje w pakiecie każdego konektora.

**Nie ma też kodu panelu administracyjnego** — i to jest korekta, a nie przeoczenie. Wspólna
etykieta statusu przebiegu i lista problemów leżały kiedyś w `admin/src/modules/pim_connector/`, a
późniejszy pomiar wykazał, że ten katalog miał jednego odbiorcę, więc oba pliki przeniesiono do
pakietu tego konektora, obok ekranów, które z nich korzystają. Pakiet modułu w ogóle nie może
odwoływać się do `admin/src`, więc wspólny komponent panelu potrzebuje *opublikowanego* miejsca —
zestawu komponentów systemu projektowego albo obsługiwanej ścieżki tego pakietu — a żadne takie
miejsce jeszcze nie istnieje, bo jeden odbiorca go nie potrzebuje. Uzasadni je dopiero drugi
konektor, który zechce korzystać z tych elementów.

## Rodzina jest deklarowana, nigdy wyliczana

Konektor dołącza do rodziny we **własnym** manifeście:

```ts
capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
```

Platforma wyprowadza przynależność z tych deklaracji przy każdej kompozycji —
`effectiveState.membersOfCapability(key)` dla członków faktycznie obecnych,
`declaredMembersOfCapability(key)` dla samej przynależności. **Nic w tym repozytorium nie
przechowuje listy konektorów.**

To celowe, a powodem jest zmiana 132 (feature 132). Lista członków była kiedyś ręcznie pisaną
tablicą w `@endora-commerce/contracts` i wymieniała dwa z ówcześnie dostarczanych konektorów —
wykluczanie obejmowało więc jedną szóstą uporządkowanych par i nic tego nie sygnalizowało, konektor
zainstalowany z npm w ogóle nie mógł do niej dołączyć, a moduł nakładkowy wdrożenia musiał w tym
celu edytować plik rdzenia. Gdy przynależność wynika z deklaracji, konektor, który ją deklaruje,
jest objęty regułą **przez sam fakt istnienia**, a konektor, który przestaje ją deklarować, opuszcza
rodzinę, zamiast zostawiać po sobie asercję, która nadal przechodzi.

Członek **nie musi** zależeć od `pim_connector`, żeby być objęty regułą: punkt egzekwowania należy
do właściciela. Deklaruj tę zależność tylko wtedy, gdy konektor sam pobiera port rejestru. Wdrożenie,
które instaluje konektor *bez* tej wspólnej warstwy, ma rodzinę, która po prostu nie jest tam
wyłączna — nie ma wiersza blokady i niczego, co by ją egzekwowało.

## Wzajemne wykluczanie

Endora pozwala mieć **zainstalowanych** kilka pakietów konektorów PIM, ale operator może mieć
**aktywny najwyżej jeden** naraz. Sześć właściwości tego punktu egzekwowania ma kluczowe znaczenie:

- **Jeden punkt egzekwowania, rejestrowany przez właściciela.** Interceptor `pre` na
  `POST /api/v1/admin/modules/:id/activation`, rejestrowany raz przez `pim_connector` dla
  wyprowadzonej rodziny. Członek rodziny **nie może** rejestrować własnego interceptora wyłączności
  ani ręcznie implementować tego sprawdzenia gdziekolwiek indziej — w ten sposób nowy konektor trafił
  kiedyś do wydania bez żadnego egzekwowania.
- **Faktyczna obecność, nigdy samo ustawienie aktywacji.** Dostępność w platformie ORAZ aktywacja
  przez operatora — warunek łączny, który oblicza `effectiveState`. Moduł, którego wdrożenie nigdy
  nie zainstalowało, nie może być aktywnym konektorem (zasada XVII).
- **Odmowa następuje, zanim wykona się audytowane polecenie**, więc odrzucona aktywacja niczego nie
  zapisuje.
- **Dezaktywacja nigdy nie jest odrzucana.** Członka rodziny zawsze można wyłączyć.
- **Ponowna aktywacja aktywnego konektora nie jest odrzucana.** Trasa jest idempotentna, więc moduł,
  który już jest aktywny, jest pomijany przy szukaniu konkurenta.
- **Dwa różne klucze możliwości nigdy się nie wykluczają.** Jeden konektor PIM, jeden konektor ERP i
  jeden dostawca rejestru faktur mogą być aktywne jednocześnie.

Odmowa to `409 PIM_CONNECTOR_ALREADY_ACTIVE` ze szczegółami `{ activeModuleId: <aktywny moduł> }`.
Komunikat dla operatora jest uzupełniany po stronie klienta na podstawie tego identyfikatora, więc
wskazuje aktywny moduł tak, jak robi to ekran modułów, a nie po identyfikatorze.

`pim_connector` subskrybuje też `module.activation.changed` i zapisuje albo usuwa wiersz blokady.
Sam interceptor nigdy niczego nie zapisuje, a subskrybent sprawdza przynależność **zadeklarowaną**,
bo przy dezaktywacji członek rodziny jest już nieobecny, a test faktycznej obecności odrzuciłby
dokładnie to zdarzenie, które musi usunąć blokadę.

### Po świeżej instalacji żaden konektor nie jest aktywny

Żaden członek rodziny nie może deklarować `activation.default: true`. Jest to odrzucane przy
wyprowadzaniu, ze wskazaniem modułu, i sprawdza to kontrola statyczna. Powodem nie jest porządek:
wykluczanie rozstrzyga się na osi aktywacji, a mechanizm rozstrzygania nie zwraca źródła wartości,
więc członek aktywny domyślnie byłby aktywnym konektorem, którego nikt nie wybrał — a wzajemne
wykluczanie nie może zawodzić w stronę przepuszczania. Złagodzenie tego do „jeden członek może” nie
usuwa tego rodzaju błędu.

Domyślna instalacja nie ma więc aktywnego konektora PIM, a operator wybiera jeden na
`/platform/modules`. Zmiana dostarczanej wartości domyślnej nigdy nie nadpisuje zapisanego wyboru:
wartość domyślna obowiązuje tylko tam, gdzie wiersz ustawienia nie zawiera nadpisania, a **żadna
migracja nie może zapisać wiersza aktywacji**.

Przełączanie konektorów **nie niszczy danych**. Wiersze zaimportowane przez poprzedni konektor
pozostają w katalogu, a połączenie, mapowania, ochrony pól i historia przebiegów każdego konektora
są zachowywane i wracają bez zmian po jego ponownym włączeniu.

## Ścieżki ochrony pól

Konektory, które pozwalają administratorowi chronić lokalnie dopracowaną wartość przed nadpisaniem
przy imporcie, korzystają ze wspólnej **składni ścieżek**, dzięki czemu kontrolki w panelu
administracyjnym i walidacja są takie same we wszystkich konektorach:

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

`canonicalisePimFieldPath()` normalizuje segmenty — wielkość liter kodu języka do `ll_RR`, UUID do
małych liter, walutę do wielkich — i zwraca `null` dla wszystkiego, co nie pasuje do składni.
Usługa ochrony pól w konektorze wywołuje ją przed zapisaniem wiersza ochrony, a
`isValidPimFieldPath()` to ta sama ocena w postaci predykatu.

## Jak napisać konektor

1. **Zadeklaruj przynależność**: `capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR]` w manifeście. To
   całe dołączenie do rodziny.
2. **Zadeklaruj przełącznik operatora**: blok `activation`, którego `settingCode` wskazuje
   ustawienie logiczne, z `default: false`. Nigdy `true`.
3. **Nie** rejestruj interceptora aktywacji i nie zgłaszaj `PIM_CONNECTOR_ALREADY_ACTIVE` — ten kod
   należy do właściciela, a członek, który go deklaruje, jest odrzucany.
4. **Korzystaj** z `canonicalisePimFieldPath()` dla przełączników ochrony w edytorze produktu oraz
   ze schematów statusu przebiegu, wagi problemu, wyzwalacza, trybu i liczników z
   `packages/contracts/src/pim-connector.ts` — dzięki temu listy przebiegów i etykiety są spójne we
   wszystkich konektorach.
5. **Nie** importuj pakietu innego konektora. Wspólny kod należy do tego modułu albo do
   `packages/contracts`.

## Gdzie jest kod

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

## Kontrole

```bash
pnpm --filter @endora-commerce/mod-pim-connector run test
pnpm --filter backend exec vitest run test/unit/pim_connector test/contract/pim_connector \
  test/integration/pim_connector
```

`test/integration/pim_connector/exclusivity-pairs.test.ts` sprawdza **każdą uporządkowaną parę**
wyprowadzonej rodziny i zawiera zabezpieczenie, że wyliczona rodzina nie była pusta —
`describe.each([])` niczego nie uruchamia i właśnie tak wersja tego zestawu oparta na liście
pozostawała zielona dla par, o których nie wiedziała.

## Zobacz też

- [Referencja modułu `pim_connector`](../module-reference/pim-connector.md) — uprawnienia,
  ustawienia, aktywacja i zależności zadeklarowane w manifeście tego modułu.
- [Cykl życia modułu](../modules/lifecycle.md) — trasa aktywacji, którą przechwytuje punkt
  egzekwowania wyłączności.

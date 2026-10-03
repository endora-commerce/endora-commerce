---
title: Wspólna warstwa konektorów ERP
---

# Wspólna warstwa konektorów ERP (`erp_connector`)

Niewielki wspólny moduł, który zawiera **zachowanie potrzebne każdemu konektorowi ERP
importującemu dane do platformy**, bez importowania transportu żadnego dostawcy. Jest dostarczany z
Endorą, jest `nonDeactivatable` i nie zawiera żadnego kodu dostawcy: konektor ERP to osobny pakiet,
a wdrożenie może zainstalować żaden, jeden albo kilka.

Ta strona jest przeznaczona dla inżynierów, którzy piszą lub recenzują konektor ERP, oraz dla
każdego, kto chce wiedzieć, jak dwa konektory ERP współistnieją w jednej platformie. Transport,
proces synchronizacji i logikę zapisu konkretnego konektora dokumentuje jego własny pakiet.

## Za co odpowiada

| Obszar | Gdzie się znajduje |
| --- | --- |
| Klucz możliwości `erp-connector` i deklaracja, że wyklucza się wzajemnie | `exclusiveCapabilities` we własnym `manifest.ts` tego modułu |
| Jedyny punkt egzekwowania wykluczania, działający na wyprowadzonej rodzinie | interceptor `pre` w `src/backend/index.ts` |
| Który członek rodziny jest aktywny | `ErpConnectorRegistryService`, tabela `erp_connector_activation_lock` |
| Kod odmowy `ERP_CONNECTOR_ALREADY_ACTIVE` i jego komunikat dla operatora | `errorCodes` w manifeście, `i18n/{en,pl}.json` |
| Wspólne słownictwo zadań, przebiegów i problemów dla monitorów w panelu administracyjnym | `packages/contracts/src/erp-connector.ts` |
| Port rejestru dla kodu, który musi zapytać, który konektor jest aktywny | `erpConnectorRegistryPort` |

**Nie** odpowiada za zapisy w katalogu, klientów HTTP systemów ERP, procesory BullMQ, odbiór
webhooków ani tabele mapowań specyficzne dla dostawcy — to wszystko pozostaje w pakiecie każdego
konektora.

**Konektory PIM to osobna oś.** `erp_connector` nie współpracuje z `pim_connector`. Wdrożenie może
mieć jednocześnie aktywny konektor PIM i aktywny konektor ERP; o tym, jak dzielą między siebie
katalog — na przykład treści z PIM, a stany magazynowe i ceny z ERP — decydują konektory, a nie ta
warstwa.

## Rodzina jest deklarowana, nigdy wyliczana

Konektor dołącza do rodziny we **własnym** manifeście:

```ts
capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR],
```

Platforma wyprowadza przynależność z tych deklaracji przy każdej kompozycji —
`effectiveState.membersOfCapability(key)` dla członków faktycznie obecnych,
`declaredMembersOfCapability(key)` dla samej przynależności. Nic w tym repozytorium nie przechowuje
listy konektorów, więc konektor zainstalowany z npm i moduł nakładkowy wdrożenia dołączają do
rodziny w ten sam sposób, bez edycji żadnego pliku rdzenia. `erp_incumbent_fixture` i
`erp_challenger_fixture` ze wdrożenia `example`, w `backend/src/apps/example/modules/`, to najmniejsi
możliwi członkowie rodziny: manifest, ustawienie aktywacji i nic więcej.

## Wzajemne wykluczanie

Endora pozwala mieć **zainstalowanych** kilka pakietów konektorów ERP, ale operator może
**aktywować** najwyżej jeden naraz.

Rejestr odczytuje aktywację operatora przez `effectiveState` — ten sam warunek łączny, którego
jądro używa wszędzie — i zapisuje identyfikator aktywnego modułu w `erp_connector_activation_lock`.
Gdy operator próbuje aktywować drugi konektor ERP, podczas gdy inny jest już aktywny, endpoint
aktywacji zwraca `ERP_CONNECTOR_ALREADY_ACTIVE` z nazwą aktywnego konektora.

Przełączanie konektorów **nie niszczy danych**: mapowania tożsamości i wiersze konfiguracji
zaimportowane przez poprzedni konektor pozostają w bazie; nowy konektor przejmuje je po
identyfikatorze tam, gdzie istnieją powiązania.

Uwagi implementacyjne:

- `erp_connector` rejestruje **jeden** interceptor pre na
  `POST /api/v1/admin/modules/:id/activation`, działający na wyprowadzonej rodzinie. Wywołuje
  `assertCanActivate(<id modułu>)`, zanim zmiana zostanie zapisana. Członek rodziny nie rejestruje
  własnego interceptora wykluczania.
- `erp_connector` subskrybuje `module.activation.changed` i zapisuje albo usuwa wiersz blokady —
  sam interceptor nigdy niczego nie zapisuje. Subskrybent sprawdza przynależność **zadeklarowaną**,
  bo przy dezaktywacji członek rodziny jest już nieobecny.
- Żaden członek nie może zadeklarować `activation.default: true`: platforma odrzuca to przy
  wyprowadzaniu dla każdej możliwości wykluczającej się wzajemnie, więc świeża instalacja nie ma
  aktywnego konektora ERP, a operator wybiera go na `/platform/modules`.

## Wspólne słownictwo (kontrakty)

`packages/contracts/src/erp-connector.ts` eksportuje:

| Schemat | Przeznaczenie |
| --- | --- |
| `erpSyncJobStatusSchema` | `pending \| in_progress \| success \| error \| poison` |
| `erpSyncJobDirectionSchema` | `erp_to_shop \| shop_to_erp` |
| `erpSyncIssueSeveritySchema` | `info \| warning \| error` |
| `erpSyncRunSummarySchema` | liczniki porcji dla pulpitów monitorowania |
| `erpIdentityEntityTypeSchema` | `article \| contractor \| order \| quote_request \| offer \| sale_document` |

Stała portu:

```ts
export const ERP_CONNECTOR_REGISTRY_PORT = 'erpConnectorRegistryPort' as const;
```

Kod błędu:

```text
ERP_CONNECTOR_ALREADY_ACTIVE
details: { activeModuleId: string }
```

## Jak napisać konektor ERP

1. **Zadeklaruj przynależność**: `capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR]` w manifeście. To
   całe dołączenie do rodziny.
2. **Zadeklaruj przełącznik operatora**: blok `activation`, którego `settingCode` wskazuje
   ustawienie logiczne, z `default: false`. Nigdy `true`.
3. **Nie** rejestruj interceptora aktywacji i nie zgłaszaj `ERP_CONNECTOR_ALREADY_ACTIVE` — ten
   punkt egzekwowania i ten kod należą do tego modułu. Deklaruj
   `dependencies: ['erp_connector']` tylko wtedy, gdy konektor sam pobiera
   `erpConnectorRegistryPort`.
4. **Korzystaj** z wyliczeń kontraktu w `erp-connector.ts` dla statusu zadania, wagi problemu i
   podsumowań monitorowania — dzięki temu etykiety w panelu administracyjnym są spójne we wszystkich
   konektorach.
5. **Nie** importuj pakietu innego konektora; wspólny kod należy do `erp_connector` albo
   `packages/contracts`.

Typowy konektor ukrywa swojego klienta protokołu (OpenAPI lub innego) za portem, ma własne tabele
mapowań tożsamości, prowadzi synchronizację jako proces BullMQ i zapisuje do innych modułów
wyłącznie przez ich eksportowane porty, dzięki czemu Command Bus, izolacja tenantów i dziennik
audytu działają tam, gdzie egzekwuje je moduł docelowy.

## Gdzie jest kod

Pakiet modułu `erp_connector` zawiera usługę rejestru, encję blokady aktywacji i migracje; jego
testy jednostkowe leżą obok nich. Wspólne słownictwo w Zod znajduje się w `packages/contracts` jako
`erp-connector.ts`. Testy kontraktowe i integracyjne są w
`backend/test/{contract,integration}/erp_connector/`.

`erp_connector` celowo nie ma strony dokumentacji dla operatora: nie ma niczego, z czym operator
pracowałby bezpośrednio — ani ekranu w panelu administracyjnym, ani ustawienia, które operator
zmienia — dokładnie tak jak `pim_connector`, którego strona architektury jest siostrzaną stroną tej.
Operator czyta stronę konkretnego konektora.

## Kontrole

```bash
pnpm --filter @endora-commerce/mod-erp-connector run test
pnpm --filter backend exec vitest run test/contract/erp_connector test/integration/erp_connector
```

`test/integration/erp_connector/overlay-joins.test.ts` składa wdrożenie `example` i sprawdza, że
jego moduły nakładkowe same tworzą parę, więc przypadki wykluczania mają sens niezależnie od tego,
jakie spakowane konektory zawiera dana kopia repozytorium.

## Zobacz też

- [Wspólna warstwa konektorów PIM](./pim-connector.md) — ten sam wzorzec dla konektorów PIM
- [Wzorzec nakładki](./overlay-pattern.md) — reguły dla konkretnego klienta przez porty i dekoracje
- [Cykl życia modułu](../modules/lifecycle.md) — trasa aktywacji, którą przechwytuje punkt egzekwowania wykluczania

---
title: Wspólna warstwa łącznika ERP
---

# Wspólna warstwa łącznika ERP (`erp_connector`)

Cienki współdzielony moduł, który trzyma **zachowanie potrzebne każdemu
przychodzącemu łącznikowi ERP**, bez importu transportu dostawcy. Jest dostarczany
z Endorą, jest `nonDeactivatable` i nie zawiera żadnego kodu dostawcy: łącznik ERP
to osobny pakiet, a deployment może zainstalować żaden, jeden albo kilka.

Ta strona jest dla inżynierów piszących lub recenzujących łącznik ERP oraz dla
każdego, kto pyta, jak dwa łączniki ERP współistnieją na jednej platformie. Własny
transport łącznika, pipeline sync i logikę apply dokumentuje pakiet tego łącznika.

## Co posiada

| Troska | Gdzie żyje |
| --- | --- |
| Klucz capability `erp-connector` i deklaracja, że jest wzajemnie wykluczający | `exclusiveCapabilities` we własnym `manifest.ts` tego modułu |
| Jedyny szew wykluczania, nad wyprowadzoną rodziną | interceptor `pre` w `src/backend/index.ts` |
| Który członek trzyma roszczenie | `ErpConnectorRegistryService`, tabela `erp_connector_activation_lock` |
| Kod odmowy `ERP_CONNECTOR_ALREADY_ACTIVE` i jego zdanie dla operatora | `errorCodes` manifestu, `i18n/{en,pl}.json` |
| Wspólny słownik job/run/issue dla monitorów admin | `packages/contracts/src/erp-connector.ts` |
| Port rejestru dla kodu, który musi zapytać, kto trzyma roszczenie | `erpConnectorRegistryPort` |

**Nie** posiada zapisów katalogu, klientów HTTP ERP, procesorów BullMQ, ingressu
webhooków ani tabel mapowań specyficznych dla dostawcy — to zostaje w każdym
pakiecie łącznika.

**Łączniki PIM to osobna oś.** `erp_connector` nie wchodzi w interakcję z
`pim_connector`. Deployment może mieć aktywny łącznik PIM i aktywny łącznik ERP
jednocześnie; jak oba dzielą między siebie katalog — na przykład treść z PIM, stock
i ceny z ERP — decydują łączniki, nie ta warstwa.

## Rodzina jest deklarowana, nigdy wyliczana

Łącznik dołącza do rodziny we **własnym** manifeście:

```ts
capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR],
```

Platforma wyprowadza członkostwo z tych deklaracji przy każdej kompozycji —
`effectiveState.membersOfCapability(key)` dla członków efektywnie obecnych,
`declaredMembersOfCapability(key)` dla samego członkostwa. Nic w tym repozytorium
nie trzyma listy łączników, więc łącznik zainstalowany z npm i overlay moduł per
deployment dołączają do rodziny tak samo, bez edycji pliku core. `erp_incumbent_fixture`
i `erp_challenger_fixture` z deploymentu example, pod
`backend/src/apps/example/modules/`, to najmniejsi możliwi członkowie: manifest,
setting aktywacji i nic więcej.

## Wykluczanie wzajemne

Endora pozwala mieć **zainstalowanych** kilka pakietów łącznika ERP, ale operator
może aktywować **co najwyżej jeden** naraz.

Rejestr czyta aktywację operatora przez `effectiveState` — tę samą
koniunkcję, której kernel używa wszędzie — i persystuje id aktywnego modułu
w `erp_connector_activation_lock`. Gdy operator próbuje aktywować drugi
łącznik ERP, podczas gdy inny jest już aktywny, endpoint aktywacji zwraca
`ERP_CONNECTOR_ALREADY_ACTIVE` z nazwą trzymającego.

Przełączanie łączników jest **niedestrukcyjne**: mapowania tożsamości i wiersze
konfiguracji zaimportowane przez poprzedni łącznik pozostają w bazie; nowy
łącznik adoptuje po identyfikatorze, gdzie linki istnieją.

Notatki implementacyjne:

- `erp_connector` rejestruje **jeden** pre-interceptor na
  `POST /api/v1/admin/modules/:id/activation`, nad wyprowadzoną rodziną. Woła
  `assertCanActivate(<id modułu>)` zanim flip się zapisze. Członek nie rejestruje
  własnego interceptora wykluczania.
- `erp_connector` subskrybuje `module.activation.changed` i zapisuje albo czyści
  wiersz lock — interceptor nigdy sam nie persystuje stanu. Subskrybent sprawdza
  członkostwo **zadeklarowane**, bo przy deaktywacji członek jest już nieobecny.
- Żaden członek nie może zadeklarować `activation.default: true`: platforma odmawia
  tego przy wyprowadzaniu dla każdej wykluczającej capability, więc świeża instalacja
  nie ma aktywnego łącznika ERP, a operator wybiera go na `/platform/modules`.

## Wspólny słownik (kontrakty)

`packages/contracts/src/erp-connector.ts` eksportuje:

| Schema | Cel |
| --- | --- |
| `erpSyncJobStatusSchema` | `pending \| in_progress \| success \| error \| poison` |
| `erpSyncJobDirectionSchema` | `erp_to_shop \| shop_to_erp` |
| `erpSyncIssueSeveritySchema` | `info \| warning \| error` |
| `erpSyncRunSummarySchema` | liczniki batch dla dashboardów monitora |
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

## Pisanie łącznika ERP

1. **Zadeklaruj członkostwo**: `capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR]` w
   manifeście. To całe dołączenie do rodziny.
2. **Zadeklaruj przełącznik operatora**: blok `activation`, którego `settingCode`
   wskazuje boolean Setting, z `default: false`. Nigdy `true`.
3. **Nie** rejestruj interceptora aktywacji i nie zgłaszaj
   `ERP_CONNECTOR_ALREADY_ACTIVE` — szew i kod należą do tego modułu. Zadeklaruj
   `dependencies: ['erp_connector']` tylko wtedy, gdy łącznik sam rozwiązuje
   `erpConnectorRegistryPort`.
4. **Użyj ponownie** enumów kontraktu z `erp-connector.ts` dla statusu job, severity
   issue i podsumowań monitora — utrzymuje badge admin spójne między łącznikami.
5. **Nie** importuj pakietu innego łącznika; współdzielony kod należy do
   `erp_connector` albo `packages/contracts`.

Typowy łącznik trzyma swojego klienta wire (OpenAPI albo inny) za portem, posiada
własne tabele mapowań tożsamości, prowadzi sync jako pipeline BullMQ i zapisuje do
innych modułów wyłącznie przez ich eksportowane porty, więc Command Bus, straż
tenantów i ślad audytu działają tam, gdzie moduł docelowy je egzekwuje.

## Gdzie leży kod

Pakiet modułu `erp_connector` posiada serwis rejestru, encję activation-lock
i migracje; jego testy unit leżą obok nich. Wspólny słownik Zod żyje w
`packages/contracts` jako `erp-connector.ts`. Testy contract i integration żyją pod
`backend/test/{contract,integration}/erp_connector/`.

`erp_connector` nie wysyła strony dokumentacji operatora — celowo: nie ma własnej
powierzchni operatora — brak ekranu admin, brak settingu, który operator ustawia — dokładnie jak
`pim_connector`, którego strona architektury jest rodzeństwem tej. Operator czyta własną
stronę łącznika.

## Bramki

```bash
pnpm --filter @endora-commerce/mod-erp-connector run test
pnpm --filter backend exec vitest run test/contract/erp_connector test/integration/erp_connector
```

`test/integration/erp_connector/overlay-joins.test.ts` komponuje deployment example
i asertuje, że same jego overlay moduły tworzą parę, więc przypadki wykluczania
zachowują sens niezależnie od tego, jakie spakowane łączniki zawiera checkout.

## Powiązane lektury

- [Wspólna warstwa łącznika PIM](./pim-connector.md) — ten sam wzorzec dla łączników PIM
- [Wzorzec overlay](./overlay-pattern.md) — reguły klienta per deployment przez porty i dekoracje
- [Cykl życia modułu](../modules/lifecycle.md) — trasa aktywacji, którą przechwytuje szew wykluczania

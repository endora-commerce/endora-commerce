---
title: Wspólna warstwa łącznika ERP
---

# Wspólna warstwa łącznika ERP (`erp_connector`)

Feature `119`. Cienki współdzielony moduł, który trzyma **zachowanie potrzebne każdemu
przychodzącemu łącznikowi ERP**, bez importu transportu dostawcy. Comarch XL
(`comarch_xl`) używa go dziś; przyszłe adaptery ERP mogą adoptować tę samą warstwę.

Ta strona jest dla inżynierów rozszerzających integracje ERP lub recenzujących, jak dwa
łączniki ERP współistnieją na jednej platformie. Transport Comarch XL, pipeline i
logika apply są udokumentowane w [Łączniku Comarch ERP XL](./comarch-xl.md).

## Co posiada

| Troska | Gdzie żyje |
| --- | --- |
| Wykluczanie wzajemne — tylko jeden łącznik ERP może być aktywny u operatora naraz | `ErpConnectorRegistryService`, tabela `erp_connector_activation_lock` |
| Wspólny słownik job/run/issue dla monitorów admin | `packages/contracts/src/erp-connector.ts` |
| Port rejestru dla straży aktywacji | `erpConnectorRegistryPort` |

**Nie** posiada zapisów katalogu, XL HTTP, procesorów BullMQ, ingressu webhooków
ani tabel mapowań specyficznych dla dostawcy — to zostaje w każdym pakiecie łącznika.

**Łączniki PIM to osobna oś.** `erp_connector` nie wchodzi w interakcję z
`pim_connector`. Deployment może mieć aktywny łącznik PIM i Comarch XL jednocześnie;
podział domen (treść katalogu vs stock/ceny) jest egzekwowany w
`comarch_xl`, nie tutaj.

## Wykluczanie wzajemne (FR-006)

Endora pozwala mieć **zainstalowanych** kilka pakietów łącznika ERP, ale operator
może aktywować **co najwyżej jeden** naraz.

Rejestr czyta aktywację operatora przez `effectiveState` — tę samą
koniunkcję, której kernel używa wszędzie — i persystuje id aktywnego modułu
w `erp_connector_activation_lock`. Gdy operator próbuje aktywować drugi
łącznik ERP, podczas gdy Comarch XL jest już aktywny, endpoint aktywacji zwraca
`ERP_CONNECTOR_ALREADY_ACTIVE` z nazwą rodzeństwa.

Przełączanie łączników jest **niedestrukcyjne**: mapowania tożsamości i wiersze
konfiguracji zaimportowane przez poprzedni łącznik pozostają w bazie; nowy
łącznik adoptuje po identyfikatorze, gdzie linki istnieją.

Notatki implementacyjne:

- `comarch_xl` rejestruje **pre-interceptor** na
  `POST /api/v1/admin/modules/:id/activation`, który woła
  `assertCanActivate('comarch_xl')` zanim flip się zapisze.
- `erp_connector` subskrybuje `module.activation.changed` i zapisuje albo czyści
  wiersz lock — interceptor sam nie może persystować stanu.

Moduły konsumentów deklarują członkostwo przez `erpConnector: true` w manifeście
(odbicie `pimConnector` na pakietach PIM). Flaga jest walidowana w
`packages/contracts/src/modules.ts`.

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

## Punkty rozszerzenia dla następnego łącznika ERP

Dodając drugi pakiet łącznika ERP:

1. **Zadeklaruj** `dependencies: ['erp_connector']`, `erpConnector: true` i rozwiąż
   `erpConnectorRegistryPort` przez `lazyPort`.
2. **Zarejestruj** ten sam wzorzec pre-interceptora aktywacji co `comarch_xl` —
   odmów aktywacji, gdy rodzeństwo jest aktywne.
3. **Użyj ponownie** enumów kontraktu z `erp-connector.ts` dla statusu job, severity issue
   i podsumowań monitora — utrzymuje badge admin spójne.
4. **Nie** importuj backend pakietu innego łącznika; współdzielony kod należy do
   `erp_connector` albo `packages/contracts`.

Skopiuj **układ** z `comarch_xl` (klient OpenAPI albo inny wire za portem,
mapowanie tożsamości, pipeline BullMQ, serwisy apply), a nie nazwy pól specyficzne dla Comarch.

## Gdzie leży kod

Pakiet modułu `erp_connector` posiada serwis rejestru, encję activation-lock
i migracje. Wspólny słownik Zod żyje w `packages/contracts` jako
`erp-connector.ts`. Testy unit i contract żyją pod `backend/test/erp_connector/`.

`erp_connector` nie wysyła strony dokumentacji operatora — celowo: nie ma własnej
powierzchni operatora — brak ekranu admin, brak settingu, który operator ustawia — dokładnie jak
`pim_connector`, którego strona architektury jest rodzeństwem tej. Operator czyta stronę modułu
konsumenta; tę, którą ten rejestr dziś bramkuje, link poniżej.

## Bramki

```bash
pnpm --filter backend exec vitest run test/unit/erp_connector test/contract/erp_connector
```

## Powiązane lektury

- [Łącznik Comarch ERP XL](./comarch-xl.md) — klient OpenAPI, pipeline sync, logika apply
- [Wzorzec overlay](./overlay-pattern.md) — reguły klienta per deployment przez porty i dekoracje
- Przewodnik operatora: [Comarch ERP XL](../modules/comarch_xl.md)
- Artefakty feature: `specs/130-comarch-xl-sync/`

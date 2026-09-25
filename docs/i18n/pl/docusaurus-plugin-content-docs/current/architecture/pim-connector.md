---
title: Wspólna warstwa łącznika PIM
---

# Wspólna warstwa łącznika PIM (`pim_connector`)

Cienki współdzielony moduł, który trzyma **zachowanie potrzebne każdemu
przychodzącemu łącznikowi PIM**, bez importu transportu dostawcy. UnoPim (`pim_unopim`)
używa go dziś; Ergonode jest starszy i **nie jest refaktoryzowany**.

Ta strona jest dla inżynierów rozszerzających integracje PIM albo recenzujących, jak dwa
łączniki współistnieją na jednej platformie. Transport UnoPim i pipeline importu
są udokumentowane w [Łącznik PIM UnoPim](./pim-unopim.md).

## Co posiada

| Troska | Gdzie żyje |
| --- | --- |
| Wykluczanie wzajemne — tylko jeden łącznik PIM może być aktywny u operatora naraz | `PimConnectorRegistryService`, tabela `pim_connector_activation_lock` |
| Wspólna gramatyka ścieżek ochrony pól | `canonicalisePimFieldPath()` w `packages/contracts/src/pim-field-path.ts` |
| Słownik kontraktu dla runów, issue, triggerów | `packages/contracts/src/pim-connector.ts` |
| Prymitywy badge run/issue w admin | nic — patrz poniżej |

**Nie** posiada zapisów katalogu, faz importu, klientów dostawcy ani ingressu webhooków —
to zostaje w każdym pakiecie łącznika.

**I nie posiada kodu admin**, co jest korektą, a nie pominięciem.
Współdzielone `PimRunStatusBadge` i `PimIssueList` kiedyś leżały pod
`admin/src/modules/pim_connector/`, a późniejszy pomiar wykazał, że
katalog miał jednego konsumenta: badge `pim_ergonode` wrócił do własnej
implementacji opartej o kit, gdy moduł został spakowany, więc oba pliki przeniesiono
do `packages/modules/pim_unopim/src/admin/components/` z ekranami, które
je renderują. Pakiet modułu nie może w ogóle wskazywać `admin/src`, więc współdzielony
komponent admin potrzebuje *opublikowanego* domu — kit albo wspieranego subpath tego
pakietu — i żaden jeszcze nie istnieje, bo jeden konsument nie kupuje jednego. Trzeci
łącznik chcący tego chrome to moment, który by to kupił.

## Wykluczanie wzajemne

Endora pozwala mieć **zainstalowanych** kilka pakietów łącznika PIM, ale operator
może aktywować **co najwyżej jeden** naraz.

Rejestr czyta aktywację operatora przez `effectiveState` — tę samą
koniunkcję, której kernel używa wszędzie — i persystuje id aktywnego modułu
w `pim_connector_activation_lock`. Gdy operator próbuje aktywować UnoPim,
podczas gdy Ergonode jest już aktywny, endpoint aktywacji zwraca
`PIM_CONNECTOR_ALREADY_ACTIVE` z nazwą rodzeństwa.

Przełączanie łączników jest **niedestrukcyjne**: wiersze zaimportowane przez poprzedni
łącznik zostają w katalogu; nowy łącznik adoptuje po SKU, gdzie linki
istnieją (patrz dokument operatora UnoPim).

Notatki implementacyjne:

- `pim_unopim` rejestruje **pre-interceptor** na
  `POST /api/v1/admin/modules/:id/activation`, który woła
  `assertCanActivate('pim_unopim')` zanim flip się zapisze.
- `pim_connector` subskrybuje `module.activation.changed` i zapisuje albo czyści
  wiersz lock — interceptor sam nie może persystować stanu.

## Ścieżki ochrony pól

Ergonode i UnoPim pozwalają administratorowi chronić lokalnie kuratorowaną wartość
przed nadpisaniem przy imporcie. **Gramatyka ścieżek jest współdzielona**, więc kontrolki admin i
walidacja pozostają identyczne:

```text
attribute.<key>[.<channel-uuid>[.<locale>]]
seo.<channel-uuid>.<locale>
price.<price-list-uuid>.<currency>
category.<category-uuid>
name[.<channel-uuid>[.<locale>]]
description[.<channel-uuid>[.<locale>]]
```

`canonicalisePimFieldPath()` normalizuje segmenty (wielkość LCID, UUID lower-case)
i zwraca `null` dla ścieżek poza gramatyką. Serwisy ochrony pól łącznika
wołają go przed zapisem wiersza ochrony.

## Punkty rozszerzenia dla następnego PIM

Dodając trzeci pakiet łącznika:

1. **Zadeklaruj** `dependencies: ['pim_connector']` i rozwiąż
   `PIM_CONNECTOR_REGISTRY_PORT` przez `lazyPort`.
2. **Zarejestruj** ten sam wzorzec pre-interceptora aktywacji co `pim_unopim` —
   odmów aktywacji, gdy rodzeństwo jest aktywne.
3. **Użyj ponownie** `canonicalisePimFieldPath()` dla przełączników ochrony w edytorze produktu.
4. **Użyj ponownie** enumów kontraktu z `pim-connector.ts` dla statusu run, severity issue
   i trigger — utrzymuje badge admin i listy run spójne.
5. **Nie** importuj backend pakietu innego łącznika; współdzielony kod należy do
   `pim_connector` albo `packages/contracts`.

Skopiuj **układ** z `packages/modules/pim_ergonode/README.md` (port + scripted
fake + fazowy import + workery BullMQ), a nie szczegóły GraphQL/REST.

## Gdzie leży kod

```text
packages/modules/pim_connector/
├── package.json                generated — never hand-written
├── i18n/{en,pl}.json
└── src/
    ├── manifest.ts
    ├── migrations/
    └── backend/
        ├── index.ts            registerModule, entities
        ├── entities/pim-connector-activation-lock.entity.ts
        └── services/
            └── pim-connector-registry.service.ts

packages/contracts/src/pim-connector.ts
backend/test/{unit,contract}/pim_connector/
```

## Bramki

```bash
pnpm --filter backend exec vitest run test/unit/pim_connector test/contract/pim_connector
```

## Powiązane lektury

- [Łącznik PIM UnoPim](./pim-unopim.md) — klient OAuth, bookmarki delta, webhook
- [Łącznik PIM Ergonode](./pim-ergonode.md) — pierwszy spakowany łącznik
- Przewodnik operatora: [Import z UnoPim](../modules/pim_unopim.md)

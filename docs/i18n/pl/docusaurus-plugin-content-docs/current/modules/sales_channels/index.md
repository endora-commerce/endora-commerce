---
title: Sales Channels
sidebar_label: Sales channels
sidebar_position: 1
description: Rejestr kanałów, resolver requestów, dwukierunkowe członkostwo dla każdej encji scope'owanej kanałem
---

# Sales Channels

Moduł Sales Channels to stabilny uchwyt platformy na „gdzie sprzedaż się dzieje". Każdy
element danych platformy scope'owany kanałem — produkty, kategorie, klienci, zamówienia,
wyceny, ceny, promocje, strony CMS — jest powiązany z jednym lub więcej Sales Channels
i filtrowany przez kontekst kanału przychodzącego requestu. Moduł posiada rejestr kanałów,
serwis dwukierunkowego członkostwa, middleware resolver mapujący każdy request HTTP
na dokładnie jeden kanał oraz strażniki cyklu życia, które chronią platformę przed
danymi bez kanału.

## Pojęcia

- **Sales Channel** — nazwane miejsce sprzedaży (sklep web, marketplace, lokal stacjonarny, portal dystrybutora). Niesie unikalny `code`, wielojęzyczną nazwę wyświetlaną, opcjonalne logo i kod motywu, uporządkowaną listę obsługiwanych języków z domyślnym, uporządkowaną listę obsługiwanych walut z domyślną oraz flagę `active`. Dokładnie jeden kanał w całej platformie ma `system_default = true` (wymuszane partial unique index).

- **System default channel** — kanał bootstrap tworzony przez reconciler boot-time. Jest domyślnym właścicielem każdej encji scope'owanej kanałem utworzonej bez jawnego wyboru kanału. Jest nieusuwalny i nie-deaktywowalny. Zmienna env `DEFAULT_SALES_CHANNEL_CODE` (domyślnie `default`) nazywa kanał.

- **Membership** — relacja M:N między kanałem a encją scope'owaną kanałem. Śledzone są dziewięć typów encji: `product`, `category`, `payment-method`, `delivery-method`, `organization`, `tax`, `customer`, `promotion`, `cms-page`. (`inventory-location` jest zarezerwowane na moment, gdy moduł inventory wprowadzi tę tabelę.)

- **Attribution** — relacja M:1 dla Orders i Quote Requests. Każdy wiersz jest powiązany z dokładnie jednym kanałem w momencie złożenia, a wiązanie jest niemutowalne dla audytu.

- **Inwariant at-least-one-channel (FR-008)** — każda encja scope'owana kanałem jest powiązana z co najmniej jednym kanałem przez cały czas. Usunięcie ostatniego członkostwa encji jest odrzucane, chyba że caller przekaże `fallbackToDefault=true`, wtedy encja jest ponownie wiązana z system default w tej samej transakcji.

## Resolver — request → channel

Hook Fastify `onRequest` działa na każdym requeście `/api/v1/*` i rozwiązuje go do dokładnie jednego kanału. Kolejność rozwiązywania:

1. **Nagłówek `X-Sales-Channel: <code>`** — jawny sygnał, zawsze wygrywa.
2. **Parametr query `?salesChannel=<code>`** — tylko ścieżki storefront / integracji; ignorowany na `/api/v1/admin/*`, aby zapobiec cross-channel admin bleed.
3. **Mapowanie host-based** — env `SALES_CHANNEL_HOST_MAP` (np. `serwisA.com=channel-a,serwisB.com=channel-b`).
4. **Fallback do system default** — tylko ścieżki storefront / integracji. Ścieżki admin odmawiają z `MISSING_SALES_CHANNEL_CONTEXT`, gdy `strictAdmin` jest włączone (domyślnie wyłączone podczas początkowego rollout).

Gdy krok trafia kod, który nie istnieje lub którego kanał ma `active=false`, request jest odrzucany z `UNKNOWN_SALES_CHANNEL` / `INACTIVE_SALES_CHANNEL`. Fallback nigdy nie stosuje się w tych przypadkach.

Każda odpowiedź niesie `X-Sales-Channel: <resolvedCode>`, aby cache HTTP mógł `Vary` po tym.

## Motyw storefront

`themeCode` kanału wybiera, który zestaw tokenów designu renderuje storefront — kolor, typografia, spacing, corner radius, elevation. Wybierany jest z listy na formularzu tożsamości kanału, a lista trzyma motywy faktycznie zaimplementowane w storefront; kanał bez nazwanego motywu renderuje się w domyślnym.

Storefront czyta go przez publiczny endpoint kanału:

```text
GET /api/v1/storefront/sales-channel
```

który zwraca **rozwiązany** kanał dla requestu — code, display name, scope języków i walut, `themeCode` i `logoUrl` — bez pól admin-only (`id`, `active`, `systemDefault`, `version`). Storefront stosuje motyw server-side przy pierwszym renderze, więc pierwszy HTML parsowany przez przeglądarkę kupującego już niesie markę kanału.

Motyw zmienia wygląd storefront, nie to, z czego jest zbudowany: każdy kanał renderuje te same strony tymi samymi komponentami. Per-channel *template* strony to większe pytanie i jest mierzone, nie odpowiadane, w `specs/storefront-composability-measure.md`.

Kanał skonfigurowany z kodem motywu, którego storefront nie implementuje, renderuje się w domyślnym motywie i loguje podany kod. Strona nigdy nie jest odrzucana dla kupującego i żaden inny motyw nie jest podstawiany przez zgadywanie.

## Dwukierunkowe członkostwo

Członkostwa można zarządzać równoważnie z obu stron:

```text
GET    /api/v1/admin/sales-channels/:code/:entityType
PUT    /api/v1/admin/sales-channels/:code/:entityType/:entityId
DELETE /api/v1/admin/sales-channels/:code/:entityType/:entityId?fallbackToDefault=true
GET    /api/v1/admin/sales-channels/by-entity/:entityType/:entityId
```

Obie strony delegują do `SalesChannelMembershipService`, który jest jedynym mutatorem
każdej tabeli mostu. Operatorzy docierają do tych samych danych, czy edytują panel
członkostwa Sales Channel, czy widget „Sales channels" na stronie edycji encji Product.

## Strażniki cyklu życia

| Operation | Refused when… | Error code |
|---|---|---|
| `deactivate(default)` | always | `CANNOT_MODIFY_SYSTEM_DEFAULT` |
| `delete(default)` | always | `CANNOT_MODIFY_SYSTEM_DEFAULT` |
| `delete(channel)` | any Order or Quote refers to it | `SALES_CHANNEL_HAS_ATTRIBUTIONS` |
| `delete(channel)` | any membership entity would orphan AND `fallbackToDefault=false` | `ENTITY_WOULD_HAVE_ZERO_CHANNELS` |
| `update(channel)` | submitted `expectedVersion` is stale | `STALE_SALES_CHANNEL_WRITE` |
| `create / update(channel)` | unknown language / currency code | `UNKNOWN_LANGUAGE_CODE` / `UNKNOWN_CURRENCY_CODE` |
| `create / rename(channel)` | code already in use | `DUPLICATE_SALES_CHANNEL_CODE` |

Hard-delete z `?fallbackToDefault=true` ponownie wiąże osierocone encje z system default
w tej samej transakcji przed usunięciem wiersza kanału; `ON DELETE CASCADE` tabel mostu
to siatka bezpieczeństwa dla członkostwa, które nie wymaga jawnego rebindingu.

## Ślad audytu (FR-019)

Każda zmiana tożsamości, zmiana cyklu życia i zmiana członkostwa zapisuje jeden wiersz
`audit_log_entries` synchronicznie w tej samej transakcji. Kody akcji są w
`@endora-commerce/contracts` jako `SALES_CHANNEL_AUDIT_ACTIONS`:

- `sales_channel.identity.changed` — create + update.
- `sales_channel.lifecycle.changed` — deactivate / activate / delete / system-default-promoted.
- `sales_channel.membership.changed` — add / remove (zapisy no-op nie są audytowane).

## Zmienne środowiskowe

| Name | Default | Purpose |
|---|---|---|
| `DEFAULT_SALES_CHANNEL_CODE` | `default` | Kod kanału, który boot reconciler tworzy / promuje jako `system_default = true`. |
| `SALES_CHANNEL_HOST_MAP` | empty | Pary `host=channelCode` rozdzielone przecinkami używane przez resolver, gdy brak nagłówka `X-Sales-Channel`. Przykład: `serwisA.com=channel-a,serwisB.com=channel-b`. |

Zobacz [admin-usage](./admin-usage.md) dla codziennego workflow operatora i [developer-guide](./developer-guide.md) dla integracji cross-module.

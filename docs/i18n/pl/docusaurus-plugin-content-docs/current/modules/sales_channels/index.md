---
title: Kanały sprzedaży
sidebar_label: Kanały sprzedaży
sidebar_position: 1
description: Rejestr kanałów, wyznaczanie kanału dla żądania i dwukierunkowe przypisania dla każdej encji zależnej od kanału
---

# Kanały sprzedaży

Moduł kanałów sprzedaży to stały punkt odniesienia platformy na pytanie „gdzie odbywa się sprzedaż”.
Wszystkie dane platformy zależne od kanału — produkty, kategorie, klienci, zamówienia, oferty, ceny,
promocje, strony CMS — są przypisane do jednego lub kilku kanałów sprzedaży i filtrowane według
kanału przychodzącego żądania. Moduł odpowiada za rejestr kanałów, usługę dwukierunkowych
przypisań, warstwę pośrednią, która każde żądanie HTTP przypisuje do dokładnie jednego kanału, oraz
zabezpieczenia cyklu życia chroniące platformę przed danymi bez kanału.

## Pojęcia

- **Kanał sprzedaży** — nazwane miejsce sprzedaży (sklep internetowy, marketplace, sklep
  stacjonarny, portal dystrybutora). Ma unikalny `code`, wielojęzyczną nazwę wyświetlaną,
  opcjonalne logo i kod motywu, uporządkowaną listę obsługiwanych języków z językiem domyślnym,
  uporządkowaną listę obsługiwanych walut z walutą domyślną oraz flagę `active`. Dokładnie jeden
  kanał w całej platformie ma `system_default = true` (wymusza to częściowy indeks unikalny).

- **Domyślny kanał systemowy** — kanał początkowy tworzony przy starcie przez mechanizm uzgadniania.
  Jest domyślnym właścicielem każdej encji zależnej od kanału, utworzonej bez jawnego wyboru kanału.
  Nie można go usunąć ani dezaktywować. Jego kod określa zmienna środowiskowa
  `DEFAULT_SALES_CHANNEL_CODE` (domyślnie `default`).

- **Przypisanie** — relacja wiele-do-wielu między kanałem a encją zależną od kanału. Śledzonych jest
  dziewięć typów encji: `product`, `category`, `payment-method`, `delivery-method`, `organization`,
  `tax`, `customer`, `promotion`, `cms-page`. (`inventory-location` jest zarezerwowane na czas, gdy
  moduł inventory wprowadzi tę tabelę).

- **Przynależność** — relacja wiele-do-jednego dla zamówień i zapytań ofertowych. Każdy wiersz jest w
  chwili złożenia przypisywany do dokładnie jednego kanału, a ze względu na audyt tego przypisania
  nie można zmienić.

- **Reguła „co najmniej jeden kanał”** — każda encja zależna od kanału jest zawsze przypisana do co
  najmniej jednego kanału. Usunięcie ostatniego przypisania encji jest odrzucane, chyba że
  wywołujący przekaże `fallbackToDefault=true` — wtedy w tej samej transakcji encja jest ponownie
  przypisywana do domyślnego kanału systemowego.

## Wyznaczanie kanału dla żądania

Hook Fastify `onRequest` działa dla każdego żądania `/api/v1/*` i przypisuje je do dokładnie jednego
kanału. Kolejność:

1. **Nagłówek `X-Sales-Channel: <code>`** — jawna informacja, zawsze wygrywa.
2. **Parametr zapytania `?salesChannel=<code>`** — tylko dla ścieżek storefrontu i integracji; na
   `/api/v1/admin/*` jest pomijany, aby dane jednego kanału nie przenikały do innego w panelu
   administracyjnym.
3. **Przypisanie według hosta** — zmienna środowiskowa `SALES_CHANNEL_HOST_MAP` (np.
   `serwisA.com=channel-a,serwisB.com=channel-b`).
4. **Domyślny kanał systemowy** — tylko dla ścieżek storefrontu i integracji. Ścieżki
   administracyjne odpowiadają `MISSING_SALES_CHANNEL_CONTEXT`, gdy włączone jest `strictAdmin`
   (podczas początkowego wdrażania domyślnie wyłączone).

Gdy w którymś kroku pojawi się kod, który nie istnieje, albo kanał z `active=false`, żądanie jest
odrzucane z `UNKNOWN_SALES_CHANNEL` / `INACTIVE_SALES_CHANNEL`. W tych przypadkach kanał domyślny
nigdy nie jest używany.

Każda odpowiedź ma nagłówek `X-Sales-Channel: <resolvedCode>`, aby pamięć podręczna HTTP mogła
uwzględniać go w `Vary`.

## Motyw storefrontu

`themeCode` kanału określa, którym zestawem tokenów projektowych storefront się wyświetla — kolory,
typografia, odstępy, zaokrąglenia, cienie. Wybiera się go z listy w formularzu kanału, a lista
zawiera motywy faktycznie zaimplementowane w storefroncie; kanał bez wskazanego motywu korzysta z
domyślnego.

Storefront odczytuje go przez publiczny endpoint kanału:

```text
GET /api/v1/storefront/sales-channel
```

który zwraca kanał **wyznaczony** dla żądania — kod, nazwę wyświetlaną, języki i waluty, `themeCode`
i `logoUrl` — bez pól przeznaczonych tylko dla panelu (`id`, `active`, `systemDefault`, `version`).
Storefront stosuje motyw po stronie serwera już przy pierwszym renderowaniu, więc pierwszy kod HTML,
który dostaje przeglądarka kupującego, ma już wygląd marki kanału.

Motyw zmienia wygląd storefrontu, a nie to, z czego się składa: każdy kanał wyświetla te same strony
tymi samymi komponentami. Osobny *szablon* stron dla kanału to większe zagadnienie i celowo nie jest
tu rozstrzygane.

Kanał skonfigurowany z kodem motywu, którego storefront nie implementuje, wyświetla się w motywie
domyślnym, a podany kod trafia do logu. Strona nigdy nie jest odrzucana kupującemu i żaden inny motyw
nie jest podstawiany na zasadzie zgadywania.

## Dwukierunkowe przypisania

Przypisaniami można zarządzać równoważnie z obu stron:

```text
GET    /api/v1/admin/sales-channels/:code/:entityType
PUT    /api/v1/admin/sales-channels/:code/:entityType/:entityId
DELETE /api/v1/admin/sales-channels/:code/:entityType/:entityId?fallbackToDefault=true
GET    /api/v1/admin/sales-channels/by-entity/:entityType/:entityId
```

Obie strony korzystają z `SalesChannelMembershipService`, jedynego miejsca, które zmienia dane w
tabelach łączących. Operatorzy widzą te same dane niezależnie od tego, czy edytują panel przypisań
kanału, czy widżet „Sales channels” na stronie edycji produktu.

## Zabezpieczenia cyklu życia

| Operacja | Odrzucana, gdy… | Kod błędu |
|---|---|---|
| `deactivate(default)` | zawsze | `CANNOT_MODIFY_SYSTEM_DEFAULT` |
| `delete(default)` | zawsze | `CANNOT_MODIFY_SYSTEM_DEFAULT` |
| `delete(channel)` | odwołuje się do niego jakiekolwiek zamówienie lub oferta | `SALES_CHANNEL_HAS_ATTRIBUTIONS` |
| `delete(channel)` | jakaś przypisana encja zostałaby bez kanału I `fallbackToDefault=false` | `ENTITY_WOULD_HAVE_ZERO_CHANNELS` |
| `update(channel)` | przesłane `expectedVersion` jest nieaktualne | `STALE_SALES_CHANNEL_WRITE` |
| `create / update(channel)` | nieznany kod języka lub waluty | `UNKNOWN_LANGUAGE_CODE` / `UNKNOWN_CURRENCY_CODE` |
| `create / rename(channel)` | kod jest już używany | `DUPLICATE_SALES_CHANNEL_CODE` |

Trwałe usunięcie z `?fallbackToDefault=true` w tej samej transakcji, przed usunięciem wiersza kanału,
przypisuje osierocone encje do domyślnego kanału systemowego; `ON DELETE CASCADE` tabel łączących to
zabezpieczenie dla przypisań, które nie wymagają jawnego przepisania.

## Dziennik audytu

Każda zmiana danych kanału, zmiana w cyklu życia i zmiana przypisań zapisuje synchronicznie, w tej
samej transakcji, jeden wiersz w `audit_log_entries`. Kody akcji są w `@endora-commerce/contracts`
jako `SALES_CHANNEL_AUDIT_ACTIONS`:

- `sales_channel.identity.changed` — utworzenie i aktualizacja.
- `sales_channel.lifecycle.changed` — dezaktywacja / aktywacja / usunięcie / ustawienie jako domyślny
  kanał systemowy.
- `sales_channel.membership.changed` — dodanie / usunięcie (zapisy, które niczego nie zmieniają, nie są
  audytowane).

## Zmienne środowiskowe

| Nazwa | Wartość domyślna | Przeznaczenie |
|---|---|---|
| `DEFAULT_SALES_CHANNEL_CODE` | `default` | Kod kanału, który mechanizm uzgadniania przy starcie tworzy lub ustawia jako `system_default = true`. |
| `SALES_CHANNEL_HOST_MAP` | puste | Pary `host=channelCode` rozdzielone przecinkami, z których mechanizm wyznaczania korzysta, gdy nie ma nagłówka `X-Sales-Channel`. Przykład: `serwisA.com=channel-a,serwisB.com=channel-b`. |

Codzienną pracę operatora opisuje [obsługa w panelu](./admin-usage.md), a integrację z innymi
modułami — [przewodnik dla programistów](./developer-guide.md).

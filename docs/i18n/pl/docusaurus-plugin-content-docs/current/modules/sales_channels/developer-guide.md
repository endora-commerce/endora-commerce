---
title: Przewodnik dla programistów
sidebar_position: 3
---

# Kanały sprzedaży — przewodnik dla programistów

Jak moduł backendu współpracuje z modułem kanałów sprzedaży: zawężanie zapytań do wyznaczonego
kanału, zarządzanie przypisaniami i odczyt kanału w handlerach żądań.

## Odczyt wyznaczonego kanału w trasie

Warstwa pośrednia wyznaczająca kanał ustala kanał sprzedaży każdego żądania pod `/api/v1/*` i zapisuje
go (widok `CachedChannel` wiersza) w zakresie platformy żądania, a nie na obiekcie żądania. Odczytuj
go funkcjami pomocniczymi publikowanymi przez kernel platformy:

```ts
import { getResolvedChannel } from '@endora-commerce/platform/kernel';

app.get('/api/v1/storefront/products', async () => {
  const channel = getResolvedChannel();
  return productService.list({ salesChannelId: channel.id });
});
```

`getResolvedChannel()` zgłasza błąd (`500`), gdy kanał nie został wyznaczony na danej ścieżce;
`currentSalesChannel()` z tego samego barrela zwraca wtedy `null`. Żadna z nich nie potrzebuje
`FastifyRequest`, więc usługa głęboko w łańcuchu wywołań może odczytać kanał bez przekazywania go
przez parametry. (`getResolvedChannel` nadal przyjmuje argument żądania ze względu na starsze
wywołania i go ignoruje.)

Poza obsługą żądania (zadania w tle, skrypty CLI) pobierz z kontenera `salesChannelResolutionPort` i
wywołaj `getByCode(code)` albo `getSystemDefault()`; typuj go jako `SalesChannelResolutionPort` z
`@endora-commerce/platform/kernel`. Klasa `SalesChannelResolverService`, która za nim stoi, nie jest
publikowana.

## Dostęp do kanału: trasy, które muszą pozostać otwarte

Każde żądanie `/api/v1/*` spoza ścieżek administracyjnych jest po wyznaczeniu kanału sprawdzane
regułą dostępu do kanału: żądanie niezalogowane jest przyjmowane tylko w kanale otwartym dla
niezalogowanych odwiedzających (w przeciwnym razie `403 SALES_CHANNEL_SIGN_IN_REQUIRED`), żądanie
klienta tylko w kanale przypisanym do jego organizacji (w przeciwnym razie
`403 SALES_CHANNEL_NOT_PERMITTED`). Żądania administratorów i kluczy API nie są sprawdzane. Twoja
trasa jest więc w zamkniętym sklepie odrzucana, chyba że zadeklaruje inaczej.

Trasa, której wywołujący nie jest kupującym w sklepie — albo musi do niej dotrzeć, żeby nim zostać —
deklaruje to w samej trasie:

```ts
app.post(
  '/api/v1/payments/acme/notify',
  { config: { salesChannelAccess: 'open' } },
  async (request, reply) => {
    // Still resolved to a channel, and still behind this route's own guards.
  },
);
```

**Zadeklaruj to w każdym wywołaniu zwrotnym dostawcy, które odbiera Twój moduł** — powiadomieniu
bramki płatności, webhooku statusu przewoźnika, adresie powrotu, na który dostawca przekierowuje
przeglądarkę. Takie żądania przychodzą bez sesji i zwykle bez kanału storefrontu, więc są
niezalogowanymi żądaniami w domyślnym kanale systemowym: gdy tylko operator zamknie ten kanał dla
niezalogowanych odwiedzających, niezadeklarowane wywołanie zwrotne jest odrzucane z `403`, a
powiadomienia dostawcy przestają docierać. To samo dotyczy linków w wiadomościach e-mail, które muszą
działać dla kogoś niezalogowanego (potwierdzenie, wypisanie), oraz wszystkiego, czego formularz
logowania lub rejestracji potrzebuje, zanim odwiedzający ma konto.

Nie deklaruj tego w niczym, co pokazuje lub zmienia katalog, ceny, koszyk albo zamówienia sklepu —
to właśnie chroni reguła. Samodzielna rejestracja klienta indywidualnego (B2C) celowo *nie* jest
otwarta, bo od razu loguje odwiedzającego.

`'open'` pomija wyłącznie krok dostępu. Żądanie nadal ma wyznaczany kanał (nieznany lub nieaktywny
kanał nadal jest odrzucany), a własne zabezpieczenia trasy — `requireCustomer`, `requireAdmin`,
sprawdzenie podpisu — nadal działają. W tym repozytorium zbiór otwartych tras utrzymuje
`backend/test/contract/sales_channels/channel-access-open-routes.test.ts` względem rejestru
`backend/test/helpers/channel-access-open-routes.ts`, który podaje uzasadnienie dla każdej trasy;
dodanie otwartej trasy wymaga dodania jej wpisu w rejestrze.

### Samodzielne sprawdzanie reguły

Ścieżka, która tworzy sesję klienta poza wspólnymi trasami logowania, musi odmówić, zanim ją
utworzy. Pobierz z kontenera `salesChannelAccessPort`, typowany jako `SalesChannelAccessPort` z
`@endora-commerce/platform/kernel`:

```ts
const { salesChannelAccessPort } = ctx.cradle<YourCradle>();

// Throws the 403 SALES_CHANNEL_NOT_PERMITTED refusal, with details.channelCode.
await salesChannelAccessPort.assertCustomerMayUse(account.organizationId, channel.id);

// Or read the decision, or the channels an Organization may use (cached).
const decision = await salesChannelAccessPort.decide(actor, channel);
const permitted = await salesChannelAccessPort.permittedChannelIds(organizationId);
```

Port dostarcza kernel; nie wymaga zależności w manifeście.

### Gdzie są przechowywane przypisania

Przypisaniem jest przypisanie `organization` kanału — tabela pośrednia
`sales_channel_organizations` — zapisywane wyłącznie przez `salesChannelMembershipPort`, który
przed zgłoszeniem zmiany usuwa też z pamięci podręcznej dostępu wpis organizacji. Przypisanie do
pojedynczego klienta (`sales_channel_customer_accounts`) nie bierze udziału w dostępie: pozostaje
zarejestrowane jako tabela pośrednia, a reguła go nie odczytuje ani nie zapisuje. Dostęp nadawaj,
przypisując organizację klienta, nigdy przez zapis wiersza dla pojedynczego klienta.

## Dodawanie do modułu encji zależnej od kanału

Zależność od kanału ma dwie warstwy:

1. **Schemat** — encja dostaje relację wiele-do-wielu z `sales_channels` przez nową tabelę łączącą
   `sales_channel_<entity>` (złożony klucz główny z obu identyfikatorów, `ON DELETE CASCADE` po obu
   stronach). Dodaj tę tabelę w kolejnej migracji modułu.
2. **Usługa** — każda ścieżka odczytu encji, która ma być filtrowana według kanału, przyjmuje
   parametr `salesChannelId` i łączy dane przez tabelę łączącą. Każda ścieżka tworzenia lub
   aktualizacji, która tworzy nową encję, po `persistAndFlush` wywołuje
   `bindToDefaultIfEmpty(entityType, entity.id)` na `salesChannelMembershipPort`, aby nowe encje
   domyślnie trafiały do domyślnego kanału systemowego.

Następnie dodaj wartość do wyliczenia `ChannelMemberEntityTypeSchema` w kontrakcie i **zadeklaruj
tabelę łączącą we własnym module**: wyeksportuj trójkę `{ entityType, table, entityIdColumn }` z
`src/backend/index.ts` i zarejestruj ją w hooku startowym —

```ts
ctx.onBoot(() => {
  const { salesChannelBridgeRegistry } = ctx.cradle<YourCradle>();
  for (const bridge of salesChannelBridges) salesChannelBridgeRegistry.register(bridge);
});
```

Dwukierunkowe trasy administracyjne uwzględnią ją automatycznie — osobne trasy w modułach nie są
potrzebne. Platforma celowo nie przechowuje mapy tabel łączących: kiedyś ją miała, obejmującą całe
wyliczenie, co oznaczało, że wywołanie dotyczące typu encji, którego modułu instancja nigdy nie
zainstalowała, wykonywało SQL na nieistniejącej tabeli. Typ encji, którego nie zarejestrował żaden
moduł, jest teraz odrzucany z `503 MODULE_DISABLED`, zanim cokolwiek trafi do bazy, a wyliczenie
pozostaje opublikowanym *słownikiem*, podczas gdy o tym, które typy działają, decyduje rejestr.

## Zmiana przypisań

`SalesChannelMembershipService` to jedyne miejsce, które zmienia dane w tabelach łączących. Moduł
sięga po nie jako wpis kontenera `salesChannelMembershipPort`, typowany jako
`SalesChannelMembershipPort` z `@endora-commerce/platform/kernel`; sama klasa nie jest publikowana.
Bezpośrednie INSERT / DELETE na `sales_channel_*` z innego miejsca jest zabronione, a pilnuje tego
`check:module-boundary`: przypisuje każdą tabelę `sales_channel_*` do jej właściciela na podstawie
DDL i zgłasza moduł, który zapisuje ją surowym SQL.

```ts
const result = await membershipService.addToChannel(channelId, 'product', productId);
// result.changed is false on idempotent re-add.

const removed = await membershipService.removeFromChannel(channelId, 'product', productId, {
  fallbackToDefault: true,
});
// throws ENTITY_WOULD_HAVE_ZERO_CHANNELS if it would orphan the entity AND fallbackToDefault is false.
```

## Gwarancja istnienia kanału domyślnego

`DefaultChannelReconciler` wykonuje się przy każdym starcie backendu, w kompozycji platformy
(`packages/platform/src/composition/compose-app.ts`), a więc także w serwerze testów integracyjnych. Trzy przypadki:

1. **Pusta tabela `sales_channels`** — wstawia nowy wiersz z kodem `DEFAULT_SALES_CHANNEL_CODE`
   (zmienna środowiskowa, domyślnie `default`).
2. **Wiersze istnieją, ale żaden nie ma `system_default = true`** — ustawia jako domyślny pierwszy
   wiersz w kolejności leksykograficznej, przy remisie preferując wiersz z `code = 'default'`.
3. **Dokładnie jeden wiersz ma już `system_default = true`** — nic nie robi.

Mechanizm uzgadniania nigdy nie odbiera oznaczenia, nie usuwa i nie zmienia danych kanału. Kod spoza
tego modułu zakłada, że kanał domyślny istnieje; jeśli piszesz kod infrastruktury uruchamiany przed
mechanizmem uzgadniania, najpierw wywołaj `DefaultChannelReconciler.run()`.

## Optymistyczna kontrola współbieżności przy edycji kanału

Kolumna całkowitoliczbowa `version` w `sales_channels` rośnie dokładnie o 1 przy każdej udanej
aktualizacji danych kanału. Endpoint PATCH wymaga, aby `expectedVersion` od klienta było równe
bieżącej `version` wiersza; przy niezgodności zwraca HTTP 412 `STALE_SALES_CHANNEL_WRITE` z bieżącą
`version` w odpowiedzi z błędem, aby klient mógł odświeżyć dane i spróbować ponownie.

Dodawanie i usuwanie przypisań jest z definicji idempotentne i nie zwiększa `version` kanału.

## Audyt

Każda zmiana danych kanału, zmiana w cyklu życia i zmiana przypisań zapisuje synchronicznie, w tej
samej transakcji, jeden wiersz w `audit_log_entries`. Kody akcji są w `@endora-commerce/contracts`:

```ts
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';

await auditLogService.record({
  action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
  // ...
});
```

Korzystaj ze stałych — nigdy nie wpisuj stringów na stałe — aby przyszła zmiana nazwy w wyliczeniu
lub typie poprawnie objęła wszystkie miejsca.

## Unieważnianie pamięci podręcznej

`SalesChannelsCache` (lokalna dla procesu pamięć LRU i Redis) przechowuje `CachedChannel` dla każdego
`code`. Pamięć podręczna jest unieważniana przy każdej zmianie danych lub cyklu życia przez istniejącą
szynę `EventBus`:

- `sales_channels.identity_changed` → usuwa jeden wpis według kodu.
- `sales_channels.lifecycle_changed` → usuwa jeden wpis albo wszystkie, gdy ustawiono
  `invalidateAll: true` (używane przy trwałym usunięciu).

Oba najpierw usuwają wspólny wpis w Redis, potem lokalny, z kluczem oznaczonym na czas całej
operacji, aby równoległy odczyt nie mógł ponownie zapamiętać kanału sprzed zmiany — i aby nieudane
usunięcie w Redis kierowało odczyty do PostgreSQL, zamiast zwracać wartość, którą unieważnienie
miało usunąć. `EventBus` działa w procesie, więc druga instancja dochodzi do aktualnego stanu w
30-sekundowym oknie warstwy lokalnej.

Odczyty przypisań idą bezpośrednio przez MikroORM (bez pamięci podręcznej); jeśli potrzebujesz ich
szybciej, dodaj warstwę Redis z kluczem `(entityType, entityId)` i krótkim TTL — hooki są już na
miejscu.

## Dodawanie panelu do strony edycji kanału

Strona edycji istniejącego kanału montuje strefę panelu `sales_channel.editor.after` pod formularzem
tożsamości, z właściwościami `{ channelId, saveSession }`. `saveSession` to jeden przycisk Zapisz
tej strony (zgłoszenie #407, `specs/180-one-save-zone-editors/`): panel, który zgłasza w nim swoje
przygotowane zmiany, jest liczony przez przycisk Zapisz formularza i zapisywany po kanale, w
kolejności strefy, a panel, który tego nie robi, nadal zapisuje sam — tak jak przypisanie magazynów
z modułu `inventory`, oznaczone znaczkiem *Działa od razu*. Formularz tworzenia nie uruchamia sesji.

## Adresy sklepu i prefiks języka {#storefront-urls}

Każdy adres strony sklepu ma język jako pierwszy segment. Nigdy nie składaj go ręcznie —
wyliczenie jest w `@endora-commerce/contracts`:

- `channelUrlLanguages(channel)` / `channelUrlLanguageAliases(channel)` — wyliczony prefiks
  każdego języka kanału (i aliasy rozdzielonych języków). `channel` to dowolne
  `ChannelUrlFacts` (`languages`, `defaultLanguage`, `prefixDefaultLanguage`); spełnia je
  kanał z pamięci podręcznej (`getResolvedChannel()`, `SalesChannelResolutionPort`).
- `storefrontPagePath({ path, languageCode, channel })` — ścieżka logiczna (`/c/tools`,
  `/verify?token=…`) pod prefiksem języka; rzuca wyjątek dla języka spoza kanału.
- `storefrontPagePathFor({ path, channel, requestedLanguage })` — dla wiadomości: żądany
  język, jeśli kanał go obsługuje, w przeciwnym razie język domyślny kanału; ścieżka logiczna,
  gdy kanał nie jest znany. **Każdy e-mail, przekierowanie i feed z linkiem do strony sklepu
  przechodzi przez tę funkcję albo `productPath`.**
- `productPath({ key, languageCode, channel })` — strona produktu. Wcześniej przyjmowała
  `channelDefaultLanguage` i dopisywała `?lang=`; teraz przyjmuje `channel` i nigdy nie
  dopisuje `?lang=`. `productDefaultPath(key)` to adres `x-default` bez prefiksu.

`GET /api/v1/storefront/sales-channel` zwraca `prefixDefaultLanguage`, `urlLanguages` i
`urlLanguageAliases`, więc storefront headless nigdy ich nie wylicza sam. Kształty kanału w
panelu mają `prefixDefaultLanguage`; zapisuje je audytowana komenda tożsamości kanału.

## Testowanie kodu zależnego od kanału

Korzystaj z istniejącego środowiska `setupBackendServer()` — uruchamia ono cały stos ze świeżym
kanałem `default`, uzgodnionym względem danych testowych (`en-US` / `PLN`). W testach bezpośrednio na
bazie danych użyj `setupTestDb()` i sam wywołaj `DefaultChannelReconciler.run()`, opcjonalnie
nadpisując wartości początkowe, gdy dane testowe mają inne kody języka lub waluty.

Wzorcowe testy integracyjne zależne od kanału w tym repozytorium (wycofywanie transakcji,
parametryzowane typy encji, dane testowe w surowym SQL niezależne od klas encji modułu-właściciela):

- `backend/test/integration/sales_channels/bidirectional-membership-every-bridge.test.ts` — test
  tabelaryczny dla wszystkich 9 tabel łączących.
- `backend/test/integration/sales_channels/at-least-one-channel-invariant.test.ts` — egzekwowanie
  reguły „co najmniej jeden kanał”.
- `backend/test/contract/sales_channels/admin-membership.contract.test.ts` — pokrycie po stronie HTTP.

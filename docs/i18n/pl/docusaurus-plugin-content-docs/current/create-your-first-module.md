---
title: Utwórz swój pierwszy moduł
description: Samouczek na 20 minut — dodaj własny moduł do nowej instancji Endora Commerce, z ustawieniem edytowanym w panelu administracyjnym, trasą API, uprawnieniem i tłumaczeniem, a potem wyłącz go i włącz.
sidebar_position: 3
---

# Utwórz swój pierwszy moduł

Ten samouczek bierze nową instancję i dodaje do niej jeden mały, własny moduł: **komunikat sklepu**.
Właściciel sklepu wpisuje w panelu administracyjnym krótką wiadomość ("We are closed 24-26
December"), a sklep internetowy — albo cokolwiek innego — odczytuje ją z trasy API. Zajmuje to około
20 minut.

Każde polecenie i każdy plik na tej stronie zostały uruchomione na instancji utworzonej poleceniem
`npx create-endora-commerce@latest`, w wydaniach `0.100.1` i `0.100.2`. Tam, gdzie coś dziś nie działa,
strona
mówi to w takiej ramce jak poniższa i podaje obejście:

:::caution Dzisiejsze ograniczenie
Cztery rzeczy na tej stronie są trudniejsze, niż powinny. Zebrano je w części
[Co jeszcze nie działa](#what-does-not-work-yet), każdą razem z tym, co zaobserwowano.
:::

## Czym jest moduł

**Moduł** to jedna samodzielna funkcja sklepu — blog, porównywarka produktów, newsletter. W
**manifeście** deklaruje, czym jest (nazwę, ustawienia, uprawnienia, od czego zależy), a w jednej
funkcji, `registerModule`, rejestruje to, co robi (swoje usługi i trasy API). Platforma składa
każdy moduł w ten sam sposób, dlatego moduł można wyłączyć, a wtedy zachowuje się tak, jakby nigdy
nie był zainstalowany.

Moduły, które przyszły z instancją, są pakietami w `node_modules` i nigdy ich nie edytujesz. Twój
własny moduł mieszka w katalogu `apps/<deployment>/modules/` instancji i nazywa się **modułem
nakładkowym** (overlay): jest dokładany na wierzch platformy i żaden plik platformy się nie zmienia.

## Czego potrzebujesz

- Instancji z [Pierwszych kroków](./getting-started.md). Ta strona zakłada, że jest w katalogu
  `my-shop` i ma domyślną nazwę wdrożenia, więc własne moduły trafiają do `apps/my-shop/modules/`.
  Jeśli podano `--deployment` albo katalog nazywa się inaczej, użyj katalogu, który znajdziesz w
  `apps/`.
- Uruchomionych usług deweloperskich (`pnpm run dev:services`) i administratora utworzonego podczas
  instalacji.
- Terminala w katalogu głównym instancji. Zatrzymaj `pnpm run dev:all`, jeśli działa (Ctrl-C);
  uruchomisz je ponownie w kroku 7.

## Krok 1 — Nazwij swoje wdrożenie

Platforma składa moduły nakładkowe tylko wtedy, gdy wie, jako które wdrożenie działa. Dodaj jedną
linię do pliku `.env` w katalogu głównym instancji:

```bash
echo "DEPLOYMENT=my-shop" >> .env
```

Wartość to nazwa katalogu w `apps/`. Bez tej linii nic nie kończy się błędem: modułu po prostu nie
ma i nic nie mówi dlaczego.

## Krok 2 — Dodaj pakiet kontraktów

Manifest pisze się dwiema funkcjami pomocniczymi z `@endora-commerce/contracts`. Instancja sama nie
deklaruje tego pakietu, więc dodaj go, w tym samym zakresie wersji co platforma:

```bash
pnpm add -w "@endora-commerce/contracts@$(node -p "require('./package.json').dependencies['@endora-commerce/platform']")"
```

Część w `$(…)` wypisuje zakres, który `package.json` już ma dla `@endora-commerce/platform` — na
przykład `^0.100.2` — dzięki czemu oba pakiety pozostają w jednym wydaniu.

## Krok 3 — Napisz manifest

Utwórz katalog modułu i jego manifest. Nazwa katalogu jest identyfikatorem modułu: małe litery,
cyfry i podkreślenia.

```bash
mkdir -p apps/my-shop/modules/store_notice/i18n
```

```ts title="apps/my-shop/modules/store_notice/manifest.ts"
import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

const settings = defineModuleSettingsManifest({
  moduleCode: 'store_notice',
  groups: [{ code: 'store_notice', name: 'Store notice' }],
  settings: [
    {
      code: 'store_notice.enabled',
      name: 'Store notice enabled',
      description:
        'Switches the store notice module on or off as a whole. Nothing is deleted: the notice text is kept and comes back when you switch the module on again.',
      groupCode: 'store_notice',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: 'store_notice.message',
      name: 'Notice text',
      description:
        'A short message for your customers, for example a holiday closure. Leave it empty to show nothing.',
      groupCode: 'store_notice',
      valueType: 'string',
      defaultValue: '',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'store_notice',
  name: 'Store notice',
  description: 'A short notice the shop owner writes and the storefront can display.',
  version: '1.0.0',
  dependencies: ['settings', 'auth'],
  settings,
  i18n: { bundlesDir: 'i18n' },
  permissions: [{ code: 'store_notice:read', label: 'View the store notice' }],
  activation: { settingCode: 'store_notice.enabled', default: true },
});
```

Do czego służy każda część:

- **`settings`** — dwa ustawienia należące do modułu. `store_notice.message` to dane modułu: panel
  administracyjny dostaje dla niego pole, choć nie piszesz żadnego ekranu. `store_notice.enabled`
  to wyłącznik modułu, na który wskazuje `activation`.
- **`dependencies`** — moduły, których ten moduł potrzebuje. `settings` przechowuje komunikat;
  `auth` jest właścicielem sprawdzenia, czy administrator jest zalogowany, użytego w kroku 4.
- **`permissions`** — kod uprawnienia, które chroni trasę administracyjną. Dopiero deklaracja w tym
  miejscu sprawia, że można je nadać roli.
- **`i18n`** — katalog obok manifestu, w którym leżą tłumaczenia modułu.

## Krok 4 — Zarejestruj trasy

```ts title="apps/my-shop/modules/store_notice/backend.ts"
import { z } from 'zod';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type {
  ModuleContext,
  RequireAdminFactory,
  SettingsReadPort,
} from '@endora-commerce/platform/kernel';

interface StoreNoticeCradle {
  readonly requireAdmin: RequireAdminFactory;
}

export function registerModule(ctx: ModuleContext): void {
  const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
  const readNotice = async (): Promise<{ message: string; visible: boolean }> => {
    const message = (await settings.get('store_notice.message', null, z.string())).trim();
    return { message, visible: message.length > 0 };
  };

  ctx.routes(async (app) => {
    app.get('/api/v1/store-notice', async () => ({ data: await readNotice() }));

    app.get(
      '/api/v1/admin/store-notice',
      { preHandler: ctx.cradle<StoreNoticeCradle>().requireAdmin('store_notice:read') },
      async () => ({ data: await readNotice() }),
    );
  });
}
```

- **`registerModule(ctx)`** to jedyny punkt wejścia modułu. Platforma wywołuje go raz, przy starcie.
- **`ctx.routes(…)`** rejestruje trasy i to dzięki niemu działa wyłącznik: trasy zarejestrowane tą
  drogą odpowiadają `503`, gdy moduł jest wyłączony. `app` to zwykła instancja Fastify.
- **`lazyPort(ctx, 'settingsReadPort')`** to sposób, w jaki moduł czyta coś, co udostępnia inna
  część platformy. `null` jako drugi argument czyta wartość dla całej platformy, a nie dla jednego
  kanału sprzedaży.
- **`requireAdmin('store_notice:read')`** chroni drugą trasę uprawnieniem z manifestu. Kod musi być
  identyczny.

Nic w instancji nie kompiluje tego pliku: Node uruchamia go bezpośrednio i usuwa typy w locie.
Pisz więc zwykły TypeScript — `enum`, `namespace` albo właściwość deklarowana w parametrze
konstruktora zatrzymuje start błędem `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.

## Krok 5 — Dodaj tłumaczenia

Każdy tekst widoczny dla użytkownika jest dostarczany po angielsku i po polsku. Ten moduł ma jeden:
etykietę swojego uprawnienia, pokazywaną przy edycji roli. Pliki są płaskimi mapami `klucz: tekst`.

```json title="apps/my-shop/modules/store_notice/i18n/en.json"
{
  "adminRoles.permission.store_notice:read": "View the store notice"
}
```

```json title="apps/my-shop/modules/store_notice/i18n/pl.json"
{
  "adminRoles.permission.store_notice:read": "Odczyt komunikatu sklepu"
}
```

## Krok 6 — Zainstaluj moduł

Platforma widzi już moduł i zgłasza, że nie jest zainstalowany:

```bash
pnpm run module:status
```

```text
store_notice          not-installed  —        1.0.0    settings,auth
```

Zainstaluj go. To ten krok tworzy jego ustawienia i wczytuje tłumaczenia:

```bash
pnpm run module:install store_notice
```

```text
[install] store_notice 1.0.0
  ✓ dependencies satisfied
  ✓ migrations applied: (none)
  ✓ settings reconciled: +1 groups, +2 settings (~0 updated)
  ✓ install hook completed (0 ms)
  ✓ registry updated: state=installed
```

Następnie zapisz, co Twoje wdrożenie robi teraz inaczej niż platforma:

```bash
pnpm run generate
```

W jego wyniku jest jedna linia o Twoim module:

```text
[undeclared-divergence] apps/my-shop/divergence.ts: no reason for `port-consumed:store_notice:settingsReadPort` — 'store_notice' resolves the port 'settingsReadPort', owned by a composition root
```

Instancja prowadzi raport każdego miejsca, w którym sięga do platformy, i prosi o jedno Twoje
zdanie na każdy wpis. Otwórz `apps/my-shop/divergence.ts` i podaj powód pod kluczem, który wymienia
komunikat:

```ts title="apps/my-shop/divergence.ts"
export const divergence = {
  omittedModules: [],
  decorationOrder: {},
  reasons: {
    'port-consumed:store_notice:settingsReadPort':
      'The store notice text is a Setting, so the module reads it through the settings port.',
  },
} as const;
```

Uruchom `pnpm run generate` jeszcze raz: linia znika, a
`apps/my-shop/divergence.generated.md` wymienia `store_notice` razem z Twoim zdaniem. To pierwszy
plik, do którego warto zajrzeć, gdy aktualizacja platformy zmieni coś, na czym polegasz.

## Krok 7 — Zobacz, jak działa

Uruchom instancję:

```bash
pnpm run dev:all
```

**Trasa API.** W drugim terminalu:

```bash
curl http://localhost:3001/api/v1/store-notice
```

```json
{"data":{"message":"","visible":false}}
```

**Ustawienie w panelu administracyjnym.** Otwórz panel pod adresem `http://localhost:3002`, zaloguj
się i przejdź do **System → Settings**. Znajdź grupę **Store notice**, wpisz wiadomość w polu
**Notice text** i naciśnij **Save 1 change(s)**. Zapytaj trasę ponownie:

```json
{"data":{"message":"We are closed 24-26 December. Orders ship from 27 December.","visible":true}}
```

**Uprawnienie i jego tłumaczenie.** Przejdź do **System → Roles** i wybierz rolę. Lista uprawnień
ma grupę `STORE_NOTICE` z pozycją `store_notice:read — View the store notice`. Przełącz panel na
język polski selektorem języka w górnym pasku, a ta sama linia brzmi
`Odczyt komunikatu sklepu`.

Trasa administracyjna `GET /api/v1/admin/store-notice` odpowiada `401` bez zalogowanego
administratora, a z zalogowanym — tą samą treścią co trasa publiczna; krok 8 pokazuje, jak wywołać
trasę administracyjną z terminala.

## Krok 8 — Wyłącz i włącz moduł

Każdy moduł mogą wyłączyć osoby prowadzące sklep, a wyłączony moduł zachowuje się tak, jakby nie
był zainstalowany. Nic nie jest usuwane, a ponowne włączenie przywraca wszystko.

:::caution Dzisiejsze ograniczenie
Miejscem tego wyłącznika jest ekran **Modules** panelu administracyjnego (**System → Modules**). W
instancji ten ekran pokazuje obecnie `NOT_FOUND: Resource not found.` i pustą listę, a
`pnpm run module:disable <id>` wypisuje `registry updated: state=disabled`, niczego nie zmieniając.
Dopóki obie rzeczy nie zostaną naprawione, użyj wywołania API, które wykonuje sam ekran Modules —
jak poniżej.
:::

Zaloguj się z terminala, zachowując ciasteczko sesji w pliku:

```bash
curl -c cookies.txt -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"your-password"}' \
  http://localhost:3001/api/v1/auth/admin/login
```

Wyłącz moduł:

```bash
curl -b cookies.txt -H 'content-type: application/json' \
  -d '{"active":false}' \
  http://localhost:3001/api/v1/admin/modules/store_notice/activation
```

```json
{"module":{"id":"store_notice","present":false,"platformState":"installed","activated":false,"deactivatable":true,"nonDeactivatableReason":null}}
```

Teraz trasa odmawia, bez restartu:

```bash
curl -i http://localhost:3001/api/v1/store-notice
```

```text
HTTP/1.1 503 Service Unavailable

{"error":{"code":"MODULE_DISABLED","message":"The \"store_notice\" module is off, so this action was refused. Check its state on the Modules screen.", …}}
```

Uprawnienie `store_notice:read` zniknęło też z listy uprawnień, które można nadać roli. Włącz moduł
ponownie tym samym wywołaniem z `{"active":true}`: trasa odpowiada `200`, z zapisanym komunikatem.
Na koniec usuń `cookies.txt`.

Nie napisano do tego ani linii kodu. Wynika to z dwóch rzeczy, które już zrobiono: linii
`activation` w manifeście i rejestracji tras przez `ctx.routes`.

## Co jeszcze nie działa {#what-does-not-work-yet}

Sprawdzono w wydaniach `0.100.1` i `0.100.2`. Każda pozycja to dzisiejsze ograniczenie produktu, a nie Twojego
modułu.

| Co | Co widzisz | Co zrobić |
| --- | --- | --- |
| Instalator nie zapisuje `DEPLOYMENT` | Instancja ma `apps/my-shop/`, ale w `.env` nie ma `DEPLOYMENT`, więc moduł nakładkowy po cichu nie jest składany | Krok 1 |
| `@endora-commerce/contracts` nie jest zależnością instancji | `ERR_MODULE_NOT_FOUND … '@endora-commerce/contracts'` z Twojego `manifest.ts`, przy każdym poleceniu | Krok 2 |
| Ekran Modules nie wczytuje się w instancji | `NOT_FOUND: Resource not found.` i "No modules to show" | Wywołanie API z kroku 8 |
| `pnpm run module:disable <id>` niczego nie zmienia w instancji | Wypisuje `state=disabled`; `pnpm run module:status` nadal pokazuje `installed`, a trasy nadal odpowiadają | Wywołanie API z kroku 8 |

Trzy kolejne ograniczenia decydują o tym, czym może być pierwszy moduł:

- **Moduł nakładkowy nie może mieć własnej tabeli w bazie danych.** Wnosi ustawienia, trasy,
  uprawnienia i tłumaczenia, ale żadnej encji i żadnej migracji. W instancji nie jest to odrzucane:
  katalog `migrations/` albo `entities/` w module nakładkowym jest ignorowany, tabela nie powstaje i
  nic tego nie zgłasza. Niewielki stan trzymaj w ustawieniach, tak jak ten moduł.
- **Moduł, który potrzebuje własnej tabeli, jest pakietem modułu** — podobnie jak moduł z własnym
  ekranem w panelu administracyjnym. `endora new module` tworzy szkielet takiego pakietu — z
  `--entities` dla tabeli i `--admin` dla ekranu — ale działa tylko w kopii roboczej repozytorium
  Endora Commerce. W instancji zatrzymuje się, wskazując brak pliku
  `backend/scripts/generate-module-manifests.ts`. Ten samouczek nie obejmuje ręcznego pisania
  pakietu.
- **Ten samouczek nie pokazuje komunikatu w sklepie internetowym.** Sklep, który instalator zapisał
  obok Twojej instancji, należy do Ciebie i możesz go edytować — zobacz
  [Sklep](./getting-started.md#sklep) — a trasa jest tym, co by wywołał.

## Co dalej

- [Wzorzec nakładki](./architecture/overlay-pattern.md) — wszystko, co może robić moduł nakładkowy,
  w tym zmiana działania usługi platformy przez `ctx.di.decorate`.
- [Drabina dostosowań](./architecture/customisation-ladder.md) — po który mechanizm sięgnąć
  najpierw i ile każdy z nich kosztuje przy następnej aktualizacji.
- [Uprawnienia](./architecture/permissions.md) — jak mają się do siebie kody uprawnień, role i
  moduły.
- [Cykl życia modułu](./modules/lifecycle.md) — instalowanie, włączanie, wyłączanie i
  odinstalowywanie.
- [Tłumaczenia panelu administracyjnego](./contributing/translations.md) — polski glosariusz i
  sposób wczytywania plików `i18n/` modułu.
- [Moduły](./modules/README.md) — moduły, które instancja już ma; ich strony pokazują, co
  deklaruje gotowy moduł.

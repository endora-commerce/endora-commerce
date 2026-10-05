---
title: Rozszerzanie Page Buildera
sidebar_position: 2
---

# Rozszerzanie Page Buildera

Moduł CMS dostarcza wbudowane komponenty — `Row`, `Columns`, `Text`, `Heading`, `Button`,
`InsertBlock` i inne — ale każdy inny moduł backendu może dodawać własne komponenty.
(`InsertTemplate` pozostaje zarejestrowany ze względu na dawne drzewa treści, ale nie ma go już w
palecie komponentów). W ten sposób swoje bloki deklarują już moduły `cms`, `catalog`, `orders`,
`invoices` i `transactional_emails`. Wyświetlają je nadal wbudowane komponenty z
`@endora-commerce/cms-components` i `@endora-commerce/email-components`; pakiet modułu spoza
platformy dostarcza własne, jak opisuje sekcja 2. Moduł, który dodaje komponent, robi to w dwóch
miejscach:

1. **Deklaracja w manifeście**: zadeklaruj metadane bloku — nazwę, etykiety,
   kategorię palety, konteksty i edytowalne pola — we własnym `manifest.ts`
   modułu. Moduł CMS buduje rejestr Page Buildera z manifestów złożonych
   modułów, więc nie ma żadnego wywołania rejestracji do napisania.
2. **Komponenty wyświetlające**: dostarcz, we własnym pakiecie modułu, kod,
   który wyświetla blok na storefroncie, w e-mailu i w edytorach panelu administracyjnego.

## 1. Deklaracja bloku w manifeście

Dodaj `blocks` i `blockCategories` do manifestu modułu:

```ts
// the promotions module: src/manifest.ts
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'promotions',
  // ...name, version, dependencies...
  blocks: [
    {
      name: 'promotions.PromoBanner',
      labelKey: 'blocks.promoBanner.label',
      descriptionKey: 'blocks.promoBanner.description',
      category: 'promotions',
      /** Omit email/invoice — this component is storefront-only. */
      contexts: ['cms'],
      fields: {
        headline: { type: 'text', label: 'Headline', required: true },
        codeInput: { type: 'text', label: 'Promo code' },
        tone: {
          type: 'select',
          label: 'Tone',
          options: [
            { label: 'Info', value: 'info' },
            { label: 'Urgent', value: 'urgent' },
          ],
        },
      },
      previewIcon: 'ticket',
      weight: 10,
    },
  ],
  blockCategories: [
    { key: 'promotions', titleKey: 'blocks.category.promotions', contexts: ['cms'] },
  ],
});
```

Schematy to `BlockDefinitionSchema` i `BlockCategorySchema` w
`packages/contracts/src/cms.ts` (oba eksportuje `@endora-commerce/contracts`). `defineModuleManifest` odrzuca manifest,
który łamie jedną z dwóch reguł:

- Nazwa bloku (`name`) ma postać `<module id>.<PascalCaseName>`, a część przed
  kropką musi być `id` modułu deklarującego. Nazwa jest zapisywana w
  przechowywanej treści strony i nigdy nie jest przepisywana, więc wybierz ją
  raz.
- `category` bloku musi być zadeklarowana w `blockCategories` tego samego
  manifestu dla każdego kontekstu, który blok wymienia. Kilka modułów może
  zadeklarować ten sam klucz kategorii; paleta je scala.

`labelKey`, `descriptionKey` i `titleKey` są względne wobec własnego pakietu tłumaczeń (bundle)
i18n modułu deklarującego (`blocks.promoBanner.label`, a nie
`promotions.blocks.promoBanner.label`). Nic nie może tego sprawdzić w chwili
definiowania manifestu, więc trzeba o to zadbać ręcznie.

Typy pól pochodzą ze zamkniętego enum zadeklarowanego w
`packages/contracts/src/cms.ts`: `text | textarea | number | select |
radio | array | object | external | uuid | richtext`. Te metadane są
nie zawierają Reacta; backend nigdy nie importuje komponentu wyświetlającego.

Blok jest oferowany tylko wtedy, gdy jego moduł jest obecny: rejestr filtruje
deklaracje według obecności modułu, odpowiadając na
`GET /api/v1/admin/cms/page-builder/config`, więc wyłączony moduł zabiera
swoje bloki z palety.

## 2. Komponenty wyświetlające

Pakiet modułu sam wyświetla swoje bloki. Służą do tego najwyżej trzy
**warstwy** — po jednej na każdy proces, który wyświetla blok — oraz
opcjonalny arkusz stylów. Każda jest ścieżką w mapie `exports` pakietu i każda
jest opcjonalna: moduł, którego bloki trafiają tylko do e-maili, dostarcza
warstwę e-mail i nic więcej.

| Ścieżka | Co eksportuje | Kto z niej korzysta |
| --- | --- | --- |
| `./storefront` | `contributions` — komponenty React wyświetlające bloki modułu w kontekście `cms` | storefront, w kodzie HTML generowanym po stronie serwera |
| `./email` | `emailBlocks` — czyste funkcje zamieniające bloki modułu w kontekście `email` na HTML i tekst | backend podczas wysyłki oraz edytor e-maili w panelu |
| `./admin` | `contributions.blocks` — komponenty dla edytorów, obok tras i stref modułu | edytor CMS i edytor e-maili w panelu |
| `./blocks.css` | jeden gotowy arkusz stylów | storefront i edytor w panelu |

Dotyczy to **pakietu** modułu — takiego, który storefront i instancja
instalują z rejestru. Własne moduły platformy nie dostarczają jeszcze tych
warstw: ich `package.json` jest generowany, a generator nie zapisuje tych
trzech ścieżek. Moduł nakładkowy (overlay) nie ma pakietu; jego bloki opisuje
sekcja [Blok, którego nie wyświetla żaden pakiet](#blok-którego-nie-wyświetla-żaden-pakiet).

Przykłady poniżej cytują moduł, na którym platforma sama sprawdza ten
mechanizm: moduł spoza wszystkich pakietów platformy, który dostarcza
wszystkie trzy warstwy i arkusz stylów dla jednego bloku,
`acceptance_blocks.Badge`.

### Pakiet

Każda powierzchnia znajduje pakiet po jego własnym `package.json`:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/package.json -->
```json
"files": [
  "dist",
  "i18n",
  "blocks.css",
  "tailwind.css"
],
"endora": {
  "type": "module",
  "id": "acceptance_blocks"
},
"exports": {
  ".": {
    "types": "./dist/manifest.d.ts",
    "default": "./dist/manifest.js"
  },
  "./backend": {
    "types": "./dist/backend/index.d.ts",
    "default": "./dist/backend/index.js"
  },
  "./admin": {
    "types": "./dist/admin/index.d.ts",
    "default": "./dist/admin/index.js"
  },
  "./storefront": {
    "types": "./dist/storefront/index.d.ts",
    "default": "./dist/storefront/index.js"
  },
  "./email": {
    "types": "./dist/email/index.d.ts",
    "default": "./dist/email/index.js"
  },
  "./blocks.css": "./blocks.css",
  "./tailwind.css": "./tailwind.css",
  "./i18n/*": "./i18n/*",
  "./package.json": "./package.json"
```

- **`endora.type` musi mieć wartość `module`, a `endora.id` — identyfikator
  modułu**, który poprzedza nazwy jego bloków. Pakiet bez tego bloku nie jest
  pakietem modułu: `blocks:generate` informuje o tym w notce i niczego z niego
  nie rejestruje, a jego bloki wyświetlają się jako symbole zastępcze.
- **`files` wymienia wszystko, na co wskazuje wpis w `exports`** — `blocks.css`
  i `tailwind.css` obok `dist`. Wpis, którego pliku nie ma w paczce, odrzuca
  generator, który miałby go zaimportować.
- **Każda warstwa publikuje deklaracje typów** obok kodu JavaScript (warunek
  `types` powyżej). Storefront napisany w TypeScripcie importuje `./storefront`
  ze swojego wygenerowanego rejestru, a `blocks:generate` odrzuca warstwę
  storefrontu bez deklaracji jako `untyped-layer`.
- **Pakiet z `./admin` publikuje też `./tailwind.css`**, który wskazuje
  kompilacji Tailwinda w panelu, gdzie leży warstwa. `endora generate` odrzuca
  warstwę panelu bez niego. W przykładowym module to jedna linia, zacytowana
  pod listą.
- **Importy warstw to zależności równorzędne (peer)**:
  `@endora-commerce/contracts`, `@endora-commerce/page-builder-core`,
  `@endora-commerce/email-components`, `@puckeditor/core` i `react`, a dla
  backendu `@endora-commerce/platform`.
- **Pakiet buduje zwykłe `tsc`**, które zachowuje początkowe `'use client'` i
  generuje deklaracje. Importy względne zapisuje się z rozszerzeniem `.js`.

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/tailwind.css -->
```css
@source "./dist/admin";
```

Skąd pochodzą nazwy użyte w przykładach:

| Nazwa | Skąd ją importować |
| --- | --- |
| `StorefrontContributions`, `PageBuilderBlockEditorConfig`, `useBlockRenderEnvironment` | `@endora-commerce/page-builder-core/contributions` |
| `sanitizeRichHtml` | `@endora-commerce/cms-components` |
| `EmailBlockRenderers` | `@endora-commerce/email-components/render/block-renderers` |
| `escapeHtml`, `escapeAttr` | `@endora-commerce/email-components/render/escape-html` |
| `AdminContributions`, `EmailBlockRendererRegistryPort` | `@endora-commerce/contracts` |
| `ModuleContext`, `lazyPort` | `@endora-commerce/platform/kernel` |

### Deklaracja, którą wyświetlają warstwy

Blok jest zadeklarowany w manifeście modułu — dla obu kontekstów, w których
jest wyświetlany, i w sekcji palety, którą ten sam manifest deklaruje dla obu:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/manifest.ts -->
```ts
blockCategories: [
  { key: 'acceptance', titleKey: 'blocks.section', contexts: ['cms', 'email'], weight: 900 },
],
blocks: [
  {
    // The persisted name — `<endora.id>.<Name>`, and permanent. Written as a
    // literal: `endora check` reads a block's name and contexts off the
    // manifest's text, and a name it cannot read is one it cannot hold a
    // renderer to.
    name: 'acceptance_blocks.Badge',
    labelKey: 'blocks.badge.label',
    descriptionKey: 'blocks.badge.description',
    category: 'acceptance',
    contexts: ['cms', 'email'],
    fields: {
      text: { type: 'text', label: 'Text' },
      // Forces every renderer of this block to throw. It exists for the
      // failure-isolation assertion and for nothing an operator would use.
      explode: {
        type: 'radio',
        label: 'Fail on render',
        options: [
          { label: 'No', value: 'no' },
          { label: 'Yes', value: 'yes' },
        ],
      },
    },
    defaultProps: { text: 'New badge', explode: 'no' },
    weight: 10,
  },
],
```

Każdy komponent wyświetlający jest przypisany do pełnej nazwy bloku, a pakiet
wyświetla wyłącznie bloki, które **deklaruje jego własny manifest**, i tylko w
kontekście, który ten blok deklaruje: `cms` dla storefrontu i edytora CMS,
`email` dla e-maili. Nazwę i konteksty zapisz jako literały — w manifeście i w
każdej warstwie: kontrola `check:block-renderers` odczytuje je z tekstu źródła,
a nazwy, której nie potrafi odczytać, nie potrafi też powiązać z komponentem.
Klucz wyliczany wymyka się kontroli i zostaje odrzucony dopiero wtedy, gdy
powierzchnia składa konfigurację.

### Warstwa storefrontu

`src/storefront/index.ts` eksportuje `contributions`: mapę z nazwy bloku na
konfigurację komponentu Puck:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/storefront/index.ts -->
```ts
import type { StorefrontContributions } from '@endora-commerce/page-builder-core/contributions';

import { Badge } from './Badge.js';

export const contributions: StorefrontContributions = {
  blocks: {
    'acceptance_blocks.Badge': {
      defaultProps: { text: 'New badge', explode: 'no' },
      render: Badge,
    },
  },
};
```

Komponent wyświetlający to zwykły komponent React. Jego właściwościami są
zapisane właściwości bloku, pod które podstawiono powyższe `defaultProps` —
dzięki temu właściwość dodana przez moduł po zapisaniu strony nadal ma wartość:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/storefront/Badge.tsx -->
```tsx
'use client';

import { useBlockRenderEnvironment } from '@endora-commerce/page-builder-core/contributions';
import type { ReactNode } from 'react';

export interface BadgeProps {
  readonly text?: string;
  readonly explode?: string | boolean;
}

/**
 * The renderer's one built-in string — a label that is not operator content —
 * shipped in both languages inside the layer and chosen by the request's
 * content language, with English as the fallback. The storefront's own
 * catalogue belongs to the storefront's owner.
 */
const LABEL: Readonly<Record<string, string>> = { en: 'Badge', pl: 'Odznaka' };

/**
 * Synchronous, reads no browser global, and draws the same output on the
 * server and on hydration for the same props: it is part of the
 * server-rendered HTML.
 */
export function Badge({ text, explode }: BadgeProps): ReactNode {
  const { language } = useBlockRenderEnvironment();
  if (explode === true || explode === 'yes') {
    throw new Error('acceptance_blocks.Badge was asked to fail on render');
  }
  const label = LABEL[language.slice(0, 2).toLowerCase()] ?? LABEL['en'];
  return (
    <span className="acceptance_blocks-badge" title={label}>
      {`acceptance-badge:${String(text ?? '')}`}
    </span>
  );
}
```

Komponent storefrontu jest wykonywany raz na serwerze i raz w przeglądarce,
dlatego:

- jest **synchroniczny** — bez komponentów `async` — i podczas renderowania nie
  czyta żadnego obiektu przeglądarki (`window`, `document`, `localStorage`);
  wolno to robić tylko w efekcie;
- dla tych samych właściwości daje ten sam wynik na serwerze i w przeglądarce:
  bez `Date.now()`, bez `Math.random()` i bez formatowania zależnego od języka,
  jeśli język nie pochodzi z `useBlockRenderEnvironment()`;
- każdy plik warstwy zaczyna się od `'use client'`. Tego kontrola
  `check:block-renderers` nie sprawdza; warstwa bez tej dyrektywy kończy
  budowanie storefrontu błędem;
- importuje wyłącznie `react`, `react-dom`, `@puckeditor/core`,
  `@endora-commerce/page-builder-core`, `@endora-commerce/cms-components`,
  `@endora-commerce/contracts` i własne pliki. Żadnego kodu serwerowego, pakietu
  panelu, platformy ani innego modułu. Potrzebne dane bierze z właściwości, z
  kontekstu renderowania CMS albo pobiera je w efekcie;
- właściwości bloku to **dane niezaufane**: HTML wstawia się wyłącznie jako
  `dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(value) }}`;
- etykieta, którą komponent wypisuje sam — niebędąca treścią operatora — jest
  dostarczana w warstwie po angielsku i po polsku i wybierana na podstawie
  `useBlockRenderEnvironment().language`; językiem zastępczym jest angielski.

**Instalacja w storefroncie.** Właściciel storefrontu dodaje pakiet do swojego
storefrontu (`pnpm add`) i go buduje. Polecenie `blocks:generate`, uruchamiane
przez skrypty `dev` i `build` storefrontu utworzonego przez wydanie `0.103.0`
lub nowsze, znajduje każdy zainstalowany pakiet modułu deklarujący
`./storefront` lub `./blocks.css` i zapisuje rejestr oraz import arkusza
stylów — nie trzeba dopisywać niczego w żadnym pliku.

**Storefront utworzony przez wcześniejsze wydanie nie ma żadnej z tych rzeczy,
a aktualizacja ich nie dodaje.** Aktualizacja przesuwa pakiety storefrontu
i zostawia jego źródła takie, jakie zostały zapisane, więc taki storefront nie
ma skryptu `blocks:generate`, katalogu `lib/page-builder/` ani reguły
obecności modułów: warstwa storefrontu z pakietu nie jest w nim wyświetlana,
a sekcja *Blok, którego nie wyświetla żaden pakiet* i wiersz storefrontu
w sekcji *Gdy moduł jest wyłączony* poniżej go nie dotyczą, dopóki właściciel
nie przeniesie plików ręcznie. Kroki opisuje przewodnik *Aktualizacja
instancji*, w części *Bloki modułów w istniejącym storefroncie*.

Gdy `endora install` zapisuje instancję i storefront w jednym przebiegu,
dopisuje do zależności storefrontu moduły instancji, które publikują warstwę
storefrontu — jeden raz. Żaden moduł platformy jeszcze jej nie publikuje, więc
domyślna instalacja niczego nie dopisuje; pakiet dodany do instancji później
dodaje do storefrontu jego właściciel.

Co odrzuca `blocks:generate`, nie zapisując niczego i kończąc z kodem 1:

| Odmowa | Znaczenie |
| --- | --- |
| `untyped-layer` | pakiet publikuje `./storefront` bez deklaracji typów |
| `missing-layer-file` | wpis w `exports` wskazuje na plik, którego pakiet nie zawiera |
| `layer-without-subpath` | pakiet zawiera `src/storefront/index.ts`, a nie deklaruje `./storefront` |
| `duplicate-module` | dwa zainstalowane pakiety deklarują ten sam identyfikator modułu |

#### Blok, którego nie wyświetla żaden pakiet

Storefront może też wyświetlić blok samodzielnie — zwykle taki, który deklaruje
moduł nakładkowy jego własnej instancji — dopisując go w
`lib/page-builder/local-blocks.tsx`, jedynym pliku rejestru bloków, który
należy do właściciela storefrontu. Blok lokalny nigdy nie zastępuje bloku,
który wyświetla już pakiet albo platforma.

### Warstwa e-mail

`src/email/index.ts` eksportuje `emailBlocks`. Każdy element to czysta funkcja
— bez Reacta i bez operacji wejścia-wyjścia — która zwraca wiersze tabeli
tworzącej układ e-maila i zabezpiecza każdą właściwość przed wstrzyknięciem
HTML:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/email/index.ts -->
```ts
import type { EmailBlockRenderers } from '@endora-commerce/email-components/render/block-renderers';
import { escapeHtml } from '@endora-commerce/email-components/render/escape-html';

interface BadgeProps {
  readonly text?: string;
  readonly explode?: string | boolean;
}

function assertRenderable(props: BadgeProps): void {
  if (props.explode === true || props.explode === 'yes') {
    throw new Error('acceptance_blocks.Badge was asked to fail on render');
  }
}

export const emailBlocks: EmailBlockRenderers = {
  'acceptance_blocks.Badge': {
    defaultProps: { text: 'New badge' },
    html: (props: BadgeProps, ctx) => {
      assertRenderable(props);
      return (
        '<tr><td style="padding:8px 24px;font-family:Arial,Helvetica,sans-serif;">' +
        `<span style="display:inline-block;padding:4px 10px;border-radius:6px;background-color:${ctx.accentColor};color:#ffffff;font-size:14px;font-weight:bold;">` +
        `acceptance-badge:${escapeHtml(String(props.text ?? ''))}` +
        '</span></td></tr>'
      );
    },
    text: (props: BadgeProps) => {
      assertRenderable(props);
      return `acceptance-badge:${String(props.text ?? '')}\n`;
    },
  },
};
```

Pole `text` jest opcjonalne; bez niego część tekstowa powstaje z kodu HTML.
Drugi argument niesie `accentColor`, język wiadomości (`language`) — etykieta,
którą funkcja wypisuje sama, zależy od niego tak jak na storefroncie — oraz
`renderSlot(nodes)`, które wyświetla zagnieżdżoną treść własnym mechanizmem
platformy. Dyrektywy `{{var …}}` w wyniku są rozwijane później, dokładnie tak
jak we wbudowanym bloku. Warstwa importuje wyłącznie
`@endora-commerce/email-components/render/*`, `@endora-commerce/contracts` i
własne pliki, ponieważ ta sama funkcja działa w backendzie i w przeglądarce
administratora.

Backend modułu rejestruje funkcje podczas startu platformy, a manifest modułu
wymienia `email` w `dependencies`:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/manifest.ts -->
```ts
// `email` owns the registry this module registers its e-mail renderer into.
// It is non-deactivatable, so the edge never fails closed.
dependencies: ['email'],
```

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/backend/index.ts -->
```ts
import type { EmailBlockRendererRegistryPort } from '@endora-commerce/contracts';
import { lazyPort, type ModuleContext } from '@endora-commerce/platform/kernel';

import { emailBlocks } from '../email/index.js';

/** This module persists nothing. */
export const entities = [] as const;

export function registerModule(ctx: ModuleContext): void {
  // From a boot hook, unprobed: the registry is ungated and decides presence
  // itself, per render, on the contributor recorded here — so switching this
  // module off, or back on, needs no restart and no re-registration.
  ctx.onBoot(() => {
    lazyPort<EmailBlockRendererRegistryPort>(ctx, 'emailBlockRendererRegistry').register(
      'acceptance_blocks',
      emailBlocks,
    );
  });
}
```

`register` nigdy nie zgłasza wyjątku. Nazwa, która nie należy do modułu, albo
wpis bez funkcji `html` zostają odrzucone z ostrzeżeniem w logu backendu i
trafiają do tablicy `refused` zwracanej przez wywołanie — sprawdź tę tablicę w
teście.

Przez ten rejestr przechodzą zarówno e-maile transakcyjne, jak i kampanie
newslettera, a treść zawierającą blok da się zapisać w obu. Wbudowanego bloku
e-mail nie da się nadpisać: funkcja dostarczona przez moduł jest używana tylko
dla nazwy, której platforma nie wyświetla sama.

### Warstwa panelu

Warstwa `./admin` modułu — ta sama, która deklaruje jego trasy i wkłady do
stref — wymienia po jednym komponencie edytora na blok i edytor:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/admin/index.ts -->
```ts
import type { AdminContributions } from '@endora-commerce/contracts';

export const contributions: AdminContributions = {
  blocks: [
    {
      name: 'acceptance_blocks.Badge',
      context: 'cms',
      component: () => import('./badge-editor.js'),
    },
    {
      name: 'acceptance_blocks.Badge',
      context: 'email',
      component: () => import('./badge-email.js'),
    },
  ],
};
```

W edytorze CMS eksportem domyślnym jest komponent wyświetlający blok — zwykle
ten sam, którego używa storefront, więc obszar roboczy pokazuje to, co
wyświetli storefront:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/admin/badge-editor.tsx -->
```tsx
import type { PageBuilderBlockEditorConfig } from '@endora-commerce/page-builder-core/contributions';

import { Badge } from '../storefront/Badge.js';

const editor: PageBuilderBlockEditorConfig = { render: Badge };

export default editor;
```

W edytorze e-maili jest nim funkcja z warstwy e-mail, czyli ta, którą wykonuje
wysyłka, więc obszar roboczy i podgląd nie mogą różnić się od wiadomości:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/admin/badge-email.ts -->
```ts
import { emailBlocks } from '../email/index.js';

export default emailBlocks['acceptance_blocks.Badge'];
```

Etykieta bloku, sekcja palety, wartości domyślne i zestaw pól pochodzą z
deklaracji w manifeście, a nie z wkładu. Konfiguracja edytora CMS może zawierać
`fields`, aby zastąpić edytor pola zadeklarowanego w manifeście — na przykład
selektorem zamiast pola tekstowego — ale nie może dodać pola, którego manifest
nie deklaruje.

Zadeklarowany blok **bez** komponentu edytora nadal można wstawić i edytować:
edytor buduje pola z deklaracji w manifeście i pokazuje neutralny podgląd z
nazwą bloku. Tak właśnie wygląda blok modułu nakładkowego, bo moduł nakładkowy
nie ma warstwy panelu. W edytorze e-maili takiego bloku nie ma też w podglądzie
HTML, choć backend wyświetla go w wysyłanej wiadomości.

**Instalacja w instancji.** Właściciel instancji dodaje pakiet do zależności
instancji i instaluje. Następnie:

1. `pnpm run build:admin` — uruchamia `endora generate`, które wpisuje
   `./admin` pakietu do rejestru wkładów panelu, a jego `./blocks.css` do
   arkusza stylów panelu, po czym buduje panel.
2. `pnpm run module:install <identyfikator modułu>` — instalacja modułu w cyklu
   życia, która tworzy ustawienie, którym operator włącza go i wyłącza.
3. Restart backendu. Funkcje e-mail modułu są rejestrowane podczas startu.

W żadnym pliku instancji nie trzeba niczego dopisywać.

### Arkusz stylów bloków

`./blocks.css` to jeden gotowy arkusz stylów. Każdy selektor znajduje się pod
klasą z prefiksem identyfikatora modułu, a kolory i kroje pisma pochodzą z
właściwości niestandardowych motywu storefrontu, z dosłownymi wartościami
zastępczymi — dzięki temu blok dopasowuje się do motywu kanału i nadal
wyświetla się w obszarze roboczym panelu:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/blocks.css -->
```css
.acceptance_blocks-badge {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  border-radius: var(--r-md, 6px);
  background: var(--brand-600, #2563eb);
  color: #ffffff;
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.4;
}
```

Bez `@import`, bez `@tailwind`, bez `@source` i bez selektorów elementów.
Storefront importuje arkusz przez `blocks:generate`, a panel przez
`endora generate`.

### Gdy moduł jest wyłączony

Blok modułu wyłączonego przez operatora znika z każdej powierzchni, a w
zapisanej treści nic się nie zmienia:

| Powierzchnia | Co się dzieje |
| --- | --- |
| Storefront | blok nie wyświetla klientowi niczego; z parametrem `?cms_admin=1` wyświetla notkę z nazwą bloku |
| E-mail | blok nie dodaje niczego do HTML ani do tekstu; wiadomość nadal jest wysyłana, a treść zawierającą blok nadal można zapisać |
| Edytory w panelu | zapisany blok jest widocznym symbolem zastępczym, który zachowuje swoje właściwości; bloku nie ma w palecie |

Ponowne włączenie modułu przywraca wszystkie trzy, a żaden dokument nie zmienia
się w międzyczasie. Storefront kieruje się listą modułów, które backend
**zgłasza** jako nieobecne, więc blok, którego właściciela backend nie zna —
blok modułu nakładkowego — nadal się wyświetla. To samo dotyczy pakietu, który
storefront ma zainstalowany, a backend go nie składa; a gdy backend jest
nieosiągalny, żaden moduł nie jest zgłaszany jako nieobecny.

### Gdy komponent zawiedzie

Komponent, który zgłosi wyjątek, kosztuje stronę tylko ten jeden blok. Na
storefroncie i w edytorach staje się on takim samym symbolem zastępczym jak
blok bez komponentu, a bloki wokół pozostają nietknięte; w e-mailu nie dodaje
niczego, wiadomość i tak zostaje wysłana, a błąd trafia do logu wraz z nazwą
bloku i jego modułu.

### Kontrola pakietu

Uruchom kontrolę w pakiecie modułu:

```bash
pnpm exec endora check --rule check:block-renderers
```

| Wynik | Znaczenie |
| --- | --- |
| `foreign-block-name` | komponent przypisany do bloku, który należy do innego modułu |
| `undeclared-block` | komponent dla bloku, którego manifest nie deklaruje albo nie deklaruje w kontekście tej powierzchni |
| `storefront-import` | warstwa storefrontu importuje coś spoza dozwolonego zestawu |
| `raw-html` | `dangerouslySetInnerHTML`, którego wartością nie jest `sanitizeRichHtml(…)` |
| `email-layer-import` | warstwa e-mail importuje Reacta, moduł wbudowany Node albo cokolwiek spoza mechanizmu wyświetlania e-maili |
| `unscoped-stylesheet` | `./blocks.css` ma selektor poza prefiksem modułu albo dołącza inny arkusz stylów |
| `layer-without-subpath` | źródła warstwy istnieją, a mapa `exports` ich nie publikuje |

### Starsza treść musi się nadal wyświetlać

Nazwa bloku jest trwała, a jego zapisane właściwości żyją dłużej niż wersja
modułu, która je zapisała. Komponent musi wyświetlić każdy kształt właściwości,
jaki moduł kiedykolwiek opublikował: pominąć właściwość, której nie zna, i
użyć wartości domyślnej dla brakującej. Zmiana, której nie da się wprowadzić w
ten sposób, to nowy blok pod nową nazwą — a stary komponent zostaje.

## Przestrzenie nazw komponentów

Nazwy bloków są unikalne w całej platformie, a zapewnia to prefiks z id
modułu: `cms.Text`, `catalog.ProductCard`, `promotions.PromoBanner`. Dwa
moduły nie mogą zadeklarować tej samej nazwy — segment właściciela musi być
id modułu deklarującego — a jeśli kolizja mimo to dotrze do rejestru, rzuca
on `DuplicateBlockNameError`, zamiast pozwolić, by blok jednego modułu
zastąpił blok innego.

## Konteksty (`contexts`)

Każdy komponent deklaruje w `contexts`, w których edytorach Page Buildera może się pojawić:

| Kontekst | Kto z niego korzysta |
|---------|---------|
| `cms` | Strony, bloki i szablony CMS, blog |
| `email` | Edytor e-maili transakcyjnych |
| `newsletter` | Kampanie newslettera (ten sam zestaw komponentów bezpiecznych dla e-maili) |
| `invoice` | Edytor szablonów PDF faktur |

Zadeklaruj je przy bloku w manifeście. `contexts` jest wymagane i musi wymieniać co najmniej jedną
powierzchnię:

```ts
contexts: ['cms'], // CMS-only
```

Blok bez `email` / `invoice` w `contexts` nigdy nie pojawia się w tych
edytorach (np. karuzela produktów). Moduł dostarcza komponenty wyświetlające
dla kontekstów `cms` i `email`; edytor newslettera pokazuje bloki kontekstu
`email`, a bloki faktur wyświetla moduł faktur.

## Właściwości responsywne i widoczność (tylko CMS)

Page Builder w CMS obsługuje nadpisania dla poszczególnych progów szerokości, z dziedziczeniem
(telefon ← tablet ← komputer). Dla pojedynczych właściwości użyj `createResponsiveField` z
`@endora-commerce/page-builder-core`, a dla kontrolki **Visibility** komponentu —
`withResponsiveVisibility`.

Domyślne progi szerokości (konfigurowalne w ustawieniach `cms.page_builder.breakpoint.*` albo
zmiennymi środowiskowymi `CMS_PB_BREAKPOINT_*`):

- Telefon: &lt; 768px
- Tablet: 768–1023px
- Komputer: ≥ 1024px

Edytory e-maili i faktur mają jedną szerokość układu i nie pokazują pól responsywnych.

**Edytory e-maili** (transakcyjnych i newslettera) **nie** korzystają z podglądów CMS dla telefonu,
tabletu i komputera. Obszar roboczy ma stałą szerokość **600 px** (szerokość e-maila). Okno
**Preview** oferuje podgląd HTML w szerokości **600 px** i **320 px**. Pola kolorów korzystają z
palety kolorów CMS.

## Zagnieżdżanie (sloty)

Komponenty układu (`Row`, `Columns`) korzystają z pól Puck typu **slot** — zagnieżdżona treść jest
przechowywana w `props`, a nie w dawnej mapie `zones`.

## Model pudełkowy (komponenty układu i treści CMS)

Komponenty układu i treści mają na zakładce Responsive pola **odstępu zewnętrznego** (margin),
**odstępu wewnętrznego** (padding) i **obramowania**. Wartości można ustawić jednakowo albo osobno dla
każdej strony. **Columns** ma responsywną liczbę kolumn (1–12 dla każdego progu) o równej szerokości.

Przy dodawaniu nowych komponentów CMS korzystaj z `createSpacingField`, `createBorderField` i
`createColorField` z `@endora-commerce/page-builder-core`.

## Wbudowane komponenty Icons i Social

- **`Icons`** — wybrana lista ikon Lucide (ok. 100) w
  `packages/cms-components/src/components/icon-catalog.ts`, z **graficzną siatką wyboru**
  (`IconPickerField`). Nie udostępniaj pełnego katalogu Lucide.
- **`Social`** — ikony serwisów przez `react-icons/fa6` (Facebook, X, Instagram, LinkedIn, YouTube,
  TikTok, …). Elementy tablicy korzystają z `getItemSummary`, aby na liście Links pojawiała się
  wybrana **nazwa serwisu**. Układy: `icons-only` | `icons-with-labels` | `vertical-list` | `pills`.

## Dodatkowe komponenty stron docelowych

| Komponent | Przeznaczenie |
| --------- | ------- |
| `Spacer` | Odstęp pionowy z opcjonalną linią oddzielającą |
| `FeatureList` | Kolumny z ikoną, tytułem i opisem |
| `Hero` | Tło, nagłówek i wezwanie do działania na górze strony |
| `LogoStrip` | Logotypy partnerów lub klientów |
| `Testimonial` | Cytat i autor |
| `Stats` | Pasek wskaźników |
| `AnnouncementBar` | Wąski pasek z komunikatem promocyjnym |
| `SimpleTable` | Nagłówki i wiersze z kolumnami rozdzielonymi znakiem `\|` |
| `NewsletterSignup` | Formularz zapisu (ustaw `actionUrl` na endpoint newslettera) |
| `ContactFormEmbed` | Osadzony formularz w iframe albo link mailto |

## Propozycje dalszych zmian (głębsze integracje)

| Priorytet | Pomysł | Dlaczego |
| -------- | ---- | --- |
| Średni | Zapis do newslettera ↔ moduł `newsletter` | Automatyczne podłączenie endpointu zapisu dla kanału |
| Niski | Kontakt ↔ moduł formularzy | Wybór istniejącego formularza zamiast adresu iframe |

`Accordion` i `Tabs` już obsługują sekcje w stylu FAQ; korzystaj z nich zamiast osobnego komponentu
FAQ.

## Testowanie

Wzorem pakietu, który dostarcza komponenty wyświetlające, jest
`backend/acceptance/block-renderers-fixture/`, a pierwszym testem — `endora check`.
`backend/test/integration/cms/page-builder-extension.test.ts` obejmuje część deklaratywną: bloki
z manifestu trafiające do opisu Page Buildera.

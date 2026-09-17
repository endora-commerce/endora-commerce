---
title: Extending the Page Builder
sidebar_position: 2
---

# Rozszerzanie Page Buildera

Moduł CMS dostarcza wbudowane komponenty — `Row`, `Columns`, `Text`,
`Heading`, `Button`, `InsertBlock` i inne — ale każdy inny
moduł backendu może wnosić własne komponenty przez in-process
service-provider interface (SPI). (`InsertTemplate` pozostaje zarejestrowany dla
legacy drzew treści, ale nie jest już w palecie drawer.)
Moduł współtworzący uczestniczy w trzech miejscach:

1. **Backend descriptor**: rejestruj metadane pól w czasie kompozycji, żeby
   paleta komponentów admina mogła renderować kontrolki edytora.
2. **Shared renderer**: dostarcz komponent React do pakietu workspace, od którego
   zależą admin i storefront (typowo sam `@endora-commerce/cms-components`
   lub pakiet per moduł re-eksportujący z niego).
3. **Composition wiring**: przekaż helper rejestracji modułu współtworzącego
   do composition root platformy przed instancjacją pluginu CMS.

## 1. Deklaracja deskryptora

W `plugin.ts` modułu (lub dedykowanym `register-page-builder.ts`)
zadeklaruj funkcję przyjmującą registry i rejestrującą komponenty:

```ts
// the promotions module: src/backend/services/register-page-builder.ts
import type { PageBuilderRegistry } from '../../cms/services/page-builder-registry.js';

export function registerPromotionsPageBuilderComponents(
  registry: PageBuilderRegistry,
): void {
  registry.register('promotions', {
    components: {
      PromoBanner: {
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
        /** Omit email/invoice — this component is storefront-only. */
        contexts: ['cms'],
      },
    },
  });
}
```

Typy pól pochodzą ze zamkniętego enum zadeklarowanego w
`packages/contracts/src/cms.ts`: `text | textarea | number | select |
radio | array | object | external | uuid | richtext`. Te metadane są
wolne od React; backend nigdy nie importuje renderera.

## 2. Dostarczenie renderera

Dodaj React `ComponentConfig` w `packages/cms-components/src/components/`
(lub we własnym pakiecie admin/storefront modułu) i eksportuj z
entry point pakietu:

```tsx
// packages/cms-components/src/components/PromoBanner.tsx
import type { ComponentConfig } from '@measured/puck';

interface Props {
  headline: string;
  codeInput?: string;
  tone: 'info' | 'urgent';
}

export const PromoBanner: ComponentConfig<Props> = {
  fields: {
    headline: { type: 'text' },
    codeInput: { type: 'text' },
    tone: { type: 'select', options: [
      { label: 'Info', value: 'info' },
      { label: 'Urgent', value: 'urgent' },
    ] },
  },
  defaultProps: { headline: 'Spring sale', tone: 'info' },
  contexts: ['cms'],
  render: ({ headline, codeInput, tone }) => (
    <div className={`promo-banner promo-${tone}`}>
      <strong>{headline}</strong>
      {codeInput ? <code>{codeInput}</code> : null}
    </div>
  ),
};
```

Podłącz do `defaultPageBuilderConfig`, żeby edytor admin i
storefront `<Render>` pick-up'owały go:

```ts
// packages/cms-components/src/index.ts
import { PromoBanner } from './components/PromoBanner.js';

export * from './components/PromoBanner.js';

export const defaultPageBuilderConfig = {
  // ...existing categories
  components: {
    Row,
    Columns,
    Text,
    Heading,
    Button,
    InsertBlock,
    InsertTemplate,
    PromoBanner,
  },
};
```

Renderer pominięty w bundle nie psuje admina:
`PageBuilderEditor` scala deskryptor z lokalnym configiem i
podstawia `MissingComponentPlaceholder` dla każdego komponentu, który
deskryptor nazywa, a bundle nie eksportuje. Placeholder renderuje
nic na storefront, chyba że strona ładuje się z parametrem query
`?cms_admin=1` (tryb podglądu).

## 3. Wiring kompozycji

Wywołaj helper rejestracji z `composition.ts` przed instancjacją modułu CMS:

```ts
// backend/src/composition.ts
const cms = cmsModule({ emFactory, requireAdmin });
registerPromotionsPageBuilderComponents(cms.handle.pageBuilderRegistry);
```

Plugin modułu CMS czyta registry przy każdym
`GET /api/v1/admin/cms/page-builder/config`, więc rejestracja po
skonstruowaniu instancji modułu jest w porządku — edytor podnosi nowy
komponent przy następnym przeładowaniu admina.

## Namespacing nazw komponentów

Nazwy komponentów są unikalne w całej platformie. Registry ostrzega i
nadpisuje przy kolizjach; reviewerzy powinni odrzucać zmiany produkujące
warning. Konwencją jest prefiks nazw domeną modułu współtworzącego, gdy
niejednoznaczność jest prawdopodobna (`PromoBanner`, `CatalogProductCard`,
itd.).

## Dostępność kontekstów (`contexts`)

Każdy komponent deklaruje, które powierzchnie Page Buildera mogą go
eksponować przez `contexts`:

| Context | Used by |
|---------|---------|
| `cms` | CMS pages, blocks, templates, blog |
| `email` | Edytor e-maili transakcyjnych |
| `newsletter` | Kampanie newsletter (alias email-safe set) |
| `invoice` | Edytor szablonów PDF faktur |

Rejestruj w backend deskryptorze:

```ts
contexts: ['cms'], // default when omitted in registry — CMS-only
```

W `@endora-commerce/cms-components` owiń config Puck
`definePageBuilderComponent` z `@endora-commerce/page-builder-core`, żeby
filtr palety admina pozostawał zsynchronizowany. Komponenty bez `email` / `invoice` w
`contexts` nigdy nie pojawiają się w tych edytorach (np. karuzela produktów).

## Responsywne props i widoczność (tylko CMS)

CMS Page Builder wspiera nadpisania per breakpoint z dziedziczeniem
(mobile ← tablet ← desktop). Użyj `createResponsiveField` z
`@endora-commerce/page-builder-core` dla pojedynczych props i
`withResponsiveVisibility` dla kontrolki **Visibility** per komponent.

Domyślne breakpointy (konfigurowalne przez Settings
`cms.page_builder.breakpoint.*` lub env `CMS_PB_BREAKPOINT_*`):

- Mobile: &lt; 768px
- Tablet: 768–1023px
- Desktop: ≥ 1024px

Edytory e-mail i faktur używają jednej szerokości layoutu i nie eksponują
pól responsywnych.

**Edytory e-mail** (transakcyjne + newsletter) **nie** używają viewportów CMS Mobile /
Tablet / Desktop. Canvas autorski ma stałe **600px** (szerokość maila).
Modal **Preview** oferuje ramki HTML **600px** / **320px**. Pola koloru
re-używają palety kolorów CMS.

## Zagnieżdżanie (slots)

Komponenty layoutu (`Row`, `Columns`) używają pól Puck **slot** — zagnieżdżona
treść jest przechowywana w `props`, nie w legacy mapie `zones`.

## Box model (layout + content CMS)

Komponenty layoutu i content eksponują **outer spacing** (margin), **inner
spacing** (padding) i pola **border** na zakładce Responsive. Wartości
wspierają edycję uniform lub per-side. **Columns** używa responsywnej liczby
kolumn (1–12 per breakpoint) z równymi trackami.

Użyj `createSpacingField`, `createBorderField` i `createColorField` z
`@endora-commerce/page-builder-core` przy dodawaniu nowych komponentów CMS.

## Wbudowane Icons / Social

- **`Icons`** — kuratorowany allowlist Lucide (~100 ikon) w
  `packages/cms-components/src/components/icon-catalog.ts` z **wizualnym
  grid pickerem** (`IconPickerField`). Nie eksponuj pełnego katalogu Lucide.
- **`Social`** — ikony brand przez `react-icons/fa6` (Facebook, X, Instagram,
  LinkedIn, YouTube, TikTok, …). Elementy tablicy używają `getItemSummary`, żeby
  wybrana **nazwa sieci** pojawiała się na liście Links. Layouty:
  `icons-only` | `icons-with-labels` | `vertical-list` | `pills`.

## Dodatkowe komponenty landing

| Component | Purpose |
| --------- | ------- |
| `Spacer` | Odstęp pionowy + opcjonalny separator |
| `FeatureList` | Kolumny ikona + tytuł + opis |
| `Hero` | Tło + nagłówek + CTA first-fold |
| `LogoStrip` | Logotypy partnerów / zaufania |
| `Testimonial` | Cytat + autor |
| `Stats` | Pasek KPI |
| `AnnouncementBar` | Cienki pasek promocyjny |
| `SimpleTable` | Nagłówki/wiersze z separatorem pipe |
| `NewsletterSignup` | Formularz e-mail (podłącz `actionUrl` do newsletter) |
| `ContactFormEmbed` | Osadzenie iframe lub fallback mailto |

## Sugerowane follow-up (głębsze integracje)

| Priority | Idea | Why |
| -------- | ---- | --- |
| Medium | Newsletter ↔ module 048 | Auto-wire endpoint subscribe kanału |
| Low | Contact ↔ forms module | Wybierz istniejący formularz zamiast URL iframe |

`Accordion` / `Tabs` już pokrywają sekcje w stylu FAQ; preferuj je przed
dedykowanym komponentem FAQ.

## Testowanie

Platforma dostarcza scaffold TDD dla SPI w
`backend/test/integration/cms/page-builder-extension.test.ts`. Użyj
fixture w `backend/test/fixtures/cms/test-extension-module.ts` jako
szablonu przy dodawaniu testów własnych wkładów.

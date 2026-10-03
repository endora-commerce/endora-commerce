---
title: Extending the Page Builder
sidebar_position: 2
---

# Rozszerzanie Page Buildera

Moduł CMS dostarcza wbudowane komponenty — `Row`, `Columns`, `Text`,
`Heading`, `Button`, `InsertBlock` i inne — ale każdy inny
moduł backendu może wnosić własne komponenty. (`InsertTemplate` pozostaje
zarejestrowany dla starszych drzew treści, ale nie ma go już w palecie.)
W ten sposób bloki wnoszą już moduły CMS, catalog, orders, invoices i
transactional e-mail. Moduł wnoszący komponent uczestniczy w dwóch miejscach:

1. **Deklaracja w manifeście**: zadeklaruj metadane bloku — nazwę, etykiety,
   kategorię palety, konteksty i edytowalne pola — we własnym `manifest.ts`
   modułu. Moduł CMS buduje rejestr Page Buildera z manifestów złożonych
   modułów, więc nie ma żadnego wywołania rejestracji do napisania.
2. **Współdzielony renderer**: dostarcz komponent React do pakietu workspace,
   od którego zależą panel administracyjny i storefront (typowo sam
   `@endora-commerce/cms-components` lub pakiet modułu re-eksportujący z niego).

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
`packages/contracts/src/cms.ts`. `defineModuleManifest` odrzuca manifest,
który łamie jedną z dwóch reguł:

- Nazwa bloku (`name`) ma postać `<module id>.<PascalCaseName>`, a część przed
  kropką musi być `id` modułu deklarującego. Nazwa jest zapisywana w
  przechowywanej treści strony i nigdy nie jest przepisywana, więc wybierz ją
  raz.
- `category` bloku musi być zadeklarowana w `blockCategories` tego samego
  manifestu dla każdego kontekstu, który blok wymienia. Kilka modułów może
  zadeklarować ten sam klucz kategorii; paleta je scala.

`labelKey`, `descriptionKey` i `titleKey` są względne wobec własnego bundla
i18n modułu deklarującego (`blocks.promoBanner.label`, a nie
`promotions.blocks.promoBanner.label`). Nic nie może tego sprawdzić w chwili
definiowania manifestu, więc trzeba o to zadbać ręcznie.

Typy pól pochodzą ze zamkniętego enum zadeklarowanego w
`packages/contracts/src/cms.ts`: `text | textarea | number | select |
radio | array | object | external | uuid | richtext`. Te metadane są
wolne od React; backend nigdy nie importuje renderera.

Blok jest oferowany tylko wtedy, gdy jego moduł jest obecny: rejestr filtruje
deklaracje według obecności modułu, odpowiadając na
`GET /api/v1/admin/cms/page-builder/config`, więc wyłączony moduł zabiera
swoje bloki z palety.

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

Podłącz go do `defaultPageBuilderConfig` pod pełną nazwą bloku, żeby edytor
w panelu administracyjnym i wywołania `<Render>` w storefroncie go widziały:

```ts
// packages/cms-components/src/index.ts
import { PromoBanner } from './components/PromoBanner.js';

export const defaultPageBuilderConfig: Config = {
  components: {
    // ...the existing 'cms.*' and 'catalog.*' entries
    'promotions.PromoBanner': definePageBuilderComponent({
      ...(PromoBanner as unknown as ComponentConfig),
      contexts: ['cms'],
    }),
  },
};
```

Renderery CMS to ten jeden bundle (bloki e-mail renderują się w ten sam sposób
z `@endora-commerce/email-components`). Moduł publikowany poza tym
repozytorium nie może dodać renderera do żadnego z tych bundli bez zmiany w
danym pakiecie.

Renderer pominięty w bundle nie psuje admina:
`PageBuilderEditor` scala deskryptor z lokalnym configiem i
podstawia `MissingComponentPlaceholder` dla każdego komponentu, który
deskryptor nazywa, a bundle nie eksportuje. Placeholder renderuje
nic na storefront, chyba że strona ładuje się z parametrem query
`?cms_admin=1` (tryb podglądu).

## Namespacing nazw komponentów

Nazwy bloków są unikalne w całej platformie, a zapewnia to prefiks z id
modułu: `cms.Text`, `catalog.ProductCard`, `promotions.PromoBanner`. Dwa
moduły nie mogą zadeklarować tej samej nazwy — segment właściciela musi być
id modułu deklarującego — a jeśli kolizja mimo to dotrze do rejestru, rzuca
on `DuplicateBlockNameError`, zamiast pozwolić, by blok jednego modułu
zastąpił blok innego.

## Dostępność kontekstów (`contexts`)

Każdy komponent deklaruje, które powierzchnie Page Buildera mogą go
eksponować przez `contexts`:

| Context | Used by |
|---------|---------|
| `cms` | CMS pages, blocks, templates, blog |
| `email` | Edytor e-maili transakcyjnych |
| `newsletter` | Kampanie newsletter (alias email-safe set) |
| `invoice` | Edytor szablonów PDF faktur |

Deklaruj je na bloku w manifeście. `contexts` jest wymagane i musi wymieniać
co najmniej jedną powierzchnię:

```ts
contexts: ['cms'], // CMS-only
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

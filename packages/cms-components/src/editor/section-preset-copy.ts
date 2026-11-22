import type { SupportedLanguage } from '@endora-commerce/contracts/platform-language';

/**
 * The placeholder copy the six section presets (`section-presets.ts`) insert,
 * one row per shipped language (issue #1684, research R-22 as amended).
 *
 * This is **content**, not admin chrome: it is seeded into the document and
 * printed on the storefront as stored, so it is written in the **content
 * language being edited**, never the operator's admin language. The editor
 * reads that language through `PageBuilderContentLocaleProvider` and picks the
 * row with `contentDefaultsIn` (page-builder-core); a language with no row gets
 * the English. The table is typed over `SupportedLanguage`, so a shipped
 * language without its row does not compile. The preset names, descriptions
 * and the drawer's status stay in the `cms` bundle under `presets.*`.
 *
 * The copy is generic on purpose (FR-040): it describes the pattern, never a
 * site or an industry.
 */

interface TitledCopy {
  title: string;
  body: string;
}

interface DownloadCopy {
  title: string;
  subtitle: string;
}

export interface SectionPresetCopy {
  hero: { eyebrow: string; title: string; body: string; primaryButton: string; secondaryButton: string };
  mediaText: { heading: string; body: string; button: string };
  ctaCard: { heading: string; body: string; button: string };
  downloads: {
    heading: string;
    lead: string;
    linkLabel: string;
    files: readonly [DownloadCopy, DownloadCopy, DownloadCopy];
  };
  featureGrid: { heading: string; items: readonly [TitledCopy, TitledCopy, TitledCopy] };
  statement: { heading: string; body: string };
}

export const SECTION_PRESET_COPY: Readonly<Record<SupportedLanguage, SectionPresetCopy>> = {
  en: {
    hero: {
      eyebrow: 'Welcome',
      title: 'A clear headline for this page',
      body: 'Introduce the page in one or two sentences and tell visitors what they can do next.',
      primaryButton: 'Get started',
      secondaryButton: 'Learn more',
    },
    mediaText: {
      heading: 'Tell the story behind your offer',
      body: 'Use this space to explain a product, a service or an idea. Pair it with an image that shows what you describe.',
      button: 'Learn more',
    },
    ctaCard: {
      heading: 'Ready to take the next step?',
      body: 'Get in touch and we will help you find the right solution.',
      button: 'Contact us',
    },
    downloads: {
      heading: 'Downloads',
      lead: 'Documents and resources to download.',
      linkLabel: 'Download',
      files: [
        { title: 'Brochure', subtitle: 'PDF' },
        { title: 'Technical data sheet', subtitle: 'PDF' },
        { title: 'User guide', subtitle: 'PDF' },
      ],
    },
    featureGrid: {
      heading: 'Why work with us',
      items: [
        { title: 'Quality', body: 'Describe the first benefit in one sentence.' },
        { title: 'Reliability', body: 'Describe the second benefit in one sentence.' },
        { title: 'Support', body: 'Describe the third benefit in one sentence.' },
      ],
    },
    statement: {
      heading: 'A short statement about what you stand for.',
      body: 'Add a sentence or two that supports the statement.',
    },
  },
  pl: {
    hero: {
      eyebrow: 'Witamy',
      title: 'Jasny nagłówek tej strony',
      body: 'Przedstaw stronę w jednym lub dwóch zdaniach i powiedz odwiedzającym, co mogą zrobić dalej.',
      primaryButton: 'Zacznij',
      secondaryButton: 'Dowiedz się więcej',
    },
    mediaText: {
      heading: 'Opowiedz historię swojej oferty',
      body: 'Wykorzystaj to miejsce, aby opisać produkt, usługę lub pomysł. Dodaj obraz, który pokazuje to, o czym piszesz.',
      button: 'Dowiedz się więcej',
    },
    ctaCard: {
      heading: 'Gotowy na kolejny krok?',
      body: 'Skontaktuj się z nami, a pomożemy dobrać właściwe rozwiązanie.',
      button: 'Skontaktuj się',
    },
    downloads: {
      heading: 'Pliki do pobrania',
      lead: 'Dokumenty i materiały do pobrania.',
      linkLabel: 'Pobierz',
      files: [
        { title: 'Broszura', subtitle: 'PDF' },
        { title: 'Karta danych technicznych', subtitle: 'PDF' },
        { title: 'Instrukcja obsługi', subtitle: 'PDF' },
      ],
    },
    featureGrid: {
      heading: 'Dlaczego warto z nami współpracować',
      items: [
        { title: 'Jakość', body: 'Opisz pierwszą zaletę w jednym zdaniu.' },
        { title: 'Niezawodność', body: 'Opisz drugą zaletę w jednym zdaniu.' },
        { title: 'Wsparcie', body: 'Opisz trzecią zaletę w jednym zdaniu.' },
      ],
    },
    statement: {
      heading: 'Krótka deklaracja tego, co Cię wyróżnia.',
      body: 'Dodaj jedno lub dwa zdania, które ją rozwijają.',
    },
  },
};

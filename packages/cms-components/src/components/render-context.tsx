'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { FormFieldErrorCode } from '@endora-commerce/contracts';

export interface CmsRenderEmbeds {
  blocks: Record<string, ReactNode>;
  templates: Record<string, ReactNode>;
}

export interface CmsRenderAsset {
  url: string;
  mimeType?: string;
  filename?: string;
  label?: string | null;
  visibility?: 'public' | 'private';
}

/**
 * The page being rendered, as the server saw the request: its path and its
 * query parameters. A block that posts a plain form back to the page (feature
 * 163, `newsletter.Signup`) reads it for its `returnTo` and for the outcome the
 * handler put on the URL, so the outcome is in the server HTML and a visitor
 * without JavaScript sees it.
 */
export interface CmsRenderLocation {
  /** The path, starting with `/`, without the query. */
  path: string;
  /** The query parameters; a repeated key keeps its first value. */
  query: Readonly<Record<string, string>>;
}

/**
 * The words a carousel speaks to assistive technology, in the rendered page's
 * language (feature 163, T095). Strings, with `{n}` and `{m}` placeholders,
 * because the storefront's server component hands them to client components
 * and a function does not cross that boundary. An absent entry is English.
 */
export interface CmsCarouselLabelText {
  carousel?: string;
  previous?: string;
  next?: string;
  /** `{n}` of `{m}`: a slide's name. */
  slide?: string;
  /** `{n}`: a dot of a fade carousel. */
  goToSlide?: string;
  /** `{n}`: a dot of a sliding carousel. */
  goToPage?: string;
  pause?: string;
  play?: string;
  /** T131: the filter bar's accessible name. */
  filter?: string;
  /** T131: the filter's "All" button, unless the block sets its own. */
  filterAll?: string;
  /** T131: `{n}` of `{m}` items shown, announced after a filter change. */
  filterCount?: string;
}

/**
 * Feature 169 (US5): the page navigation's words, in the rendered page's
 * language. An absent entry is English.
 */
export interface CmsPageNavigationText {
  /** The nav's accessible name when the block sets none. */
  label?: string;
}

/** Feature 169 (US7): `newsletter.Signup`'s words in the page language; an absent entry is English. */
export interface CmsNewsletterSignupText {
  /** A required attribute left empty. */
  fields?: string;
}

/**
 * The words of `cms.ContactForm` in the rendered page's language (feature 169, data-model
 * §5.2), used where the block sets none of its own. Strings only — the storefront's server
 * component hands them to a client component. An absent entry is English.
 */
export interface CmsContactFormText {
  /** The form's accessible name. */
  label?: string;
  field?: Partial<Record<'name' | 'email' | 'phone' | 'company' | 'subject' | 'choice' | 'message', string>>;
  /** The select's first, empty option. */
  choicePlaceholder?: string;
  /** Plain text used when the editor wrote no consent label. */
  privacyConsent?: string;
  marketingConsent?: string;
  submit?: string;
  success?: string;
  error?: string;
  unavailable?: string;
  /** The accessible text of a required field's marker. */
  required?: string;
  /** Under a required field left empty (with JavaScript). */
  fieldRequired?: string;
  /** Under an e-mail field that holds no address (with JavaScript). */
  fieldEmail?: string;
}

/**
 * Feature 170 (`specs/170-forms-module/` contracts/blocks-and-storefront.md §4) — the built-in
 * words of `forms.Form` in the rendered page's language (the storefront's `forms` catalogue
 * namespace). Strings only, with `{n}` placeholders, because the storefront's server component
 * hands them to a client component and a function does not cross that boundary.
 */
export interface CmsFormsText {
  submit: string;
  required: string;
  optional: string;
  errorSummary: string;
  /** `{n}`: how many fields need attention. */
  errorSummaryCount: string;
  accepted: string;
  unavailable: string;
  rateLimited: string;
  tooLarge: string;
  captchaFailed: string;
  captchaUnavailable: string;
  needsJavaScript: string;
  truncatedAnswers: string;
  closed: string;
  notYetOpen: string;
  full: string;
  signIn: string;
  signInLink: string;
  selectPlaceholder: string;
  countryPlaceholder: string;
  fieldErrors: Record<FormFieldErrorCode, string>;
  addressParts: Record<'street' | 'line2' | 'postalCode' | 'city' | 'country', string>;
}

/**
 * What `forms.Form` needs from the page beyond its block data (contracts/blocks-and-storefront.md
 * §4): the words, the countries in the page language, the viewer, and the page context hidden
 * fields carry — computed by the storefront **on the server**, so a shopper without JavaScript
 * posts them too (research R-11). `attempt` is a refused no-JS submission's answers and errors,
 * read from the `forms_attempt` cookie only when the URL's `formsAttempt` matches (research R-10).
 */
export interface CmsFormsContext {
  text: CmsFormsText;
  /** The dictionary's countries, labelled in the page language. */
  countries: readonly { code: string; label: string }[];
  viewerSignedIn: boolean;
  /** The sign-in path, with a `returnTo` to this page. */
  signInPath: string;
  pageContext: {
    pageUrl: string;
    pageTitle: string;
    referrer: string;
    query: Readonly<Record<string, string>>;
  };
  attempt: {
    blockId: string;
    errors: { fieldKey: string; code: string; message: string }[];
    answers: Record<string, string | string[]>;
    truncated: boolean;
  } | null;
}

export interface CmsRenderContextValue {
  embeds: CmsRenderEmbeds;
  assets: Record<string, CmsRenderAsset>;
  /** API origin for rebasing host-relative `/assets/file/...` URLs. */
  mediaBaseUrl?: string;
  /** The rendered page's location; absent in the editor and wherever it is not known. */
  location?: CmsRenderLocation;
  /** Feature 169: the sign-up's words in the page language; absent: English. */
  newsletterSignupText?: CmsNewsletterSignupText;
  /** The page language's carousel words; absent: English. */
  carouselLabels?: CmsCarouselLabelText;
  /** Feature 169: the page language's page-navigation words; absent: English. */
  pageNavigationText?: CmsPageNavigationText;
  /**
   * Puts the page language's prefix on an internal storefront path (feature 167,
   * FR-020); absent — in the editor — paths are rendered as they are.
   */
  localizePath?: (path: string) => string;
  /** Feature 169 — the contact form's words in the page language; absent: English. */
  contactFormText?: CmsContactFormText;
  /** Feature 170 — what `forms.Form` reads from the page; absent (the editor): English, no context. */
  forms?: CmsFormsContext;
}

const emptyValue: CmsRenderContextValue = {
  embeds: { blocks: {}, templates: {} },
  assets: {},
};

export const CmsRenderContext = createContext<CmsRenderContextValue>(emptyValue);

export function CmsRenderProvider({
  embeds,
  assets = {},
  mediaBaseUrl,
  location,
  newsletterSignupText,
  carouselLabels,
  pageNavigationText,
  localizePath,
  contactFormText,
  forms,
  children,
}: {
  embeds: CmsRenderEmbeds;
  assets?: Record<string, CmsRenderAsset>;
  mediaBaseUrl?: string;
  location?: CmsRenderLocation;
  newsletterSignupText?: CmsNewsletterSignupText;
  carouselLabels?: CmsCarouselLabelText;
  pageNavigationText?: CmsPageNavigationText;
  localizePath?: (path: string) => string;
  contactFormText?: CmsContactFormText;
  forms?: CmsFormsContext;
  children: ReactNode;
}) {
  return (
    <CmsRenderContext.Provider
      value={{
        embeds,
        assets,
        ...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(newsletterSignupText !== undefined ? { newsletterSignupText } : {}),
        ...(carouselLabels !== undefined ? { carouselLabels } : {}),
        ...(pageNavigationText !== undefined ? { pageNavigationText } : {}),
        ...(localizePath !== undefined ? { localizePath } : {}),
        ...(contactFormText !== undefined ? { contactFormText } : {}),
        ...(forms !== undefined ? { forms } : {}),
      }}
    >
      {children}
    </CmsRenderContext.Provider>
  );
}

export function useCmsRenderEmbeds(): CmsRenderEmbeds {
  return useContext(CmsRenderContext).embeds;
}

export function useCmsRenderAssets(): Record<string, CmsRenderAsset> {
  return useContext(CmsRenderContext).assets;
}

export function useCmsRenderMediaBaseUrl(): string | undefined {
  return useContext(CmsRenderContext).mediaBaseUrl;
}

export function useCmsRenderLocation(): CmsRenderLocation | undefined {
  return useContext(CmsRenderContext).location;
}

/** Feature 169: the sign-up's words in the page language, if the page provided them. */
export function useCmsRenderNewsletterSignupText(): CmsNewsletterSignupText | undefined {
  return useContext(CmsRenderContext).newsletterSignupText;
}

export function useCmsRenderCarouselLabels(): CmsCarouselLabelText | undefined {
  return useContext(CmsRenderContext).carouselLabels;
}

/** Feature 169: the page language's page-navigation words; absent (the editor): English. */
export function useCmsRenderPageNavigationText(): CmsPageNavigationText | undefined {
  return useContext(CmsRenderContext).pageNavigationText;
}

const identity = (path: string): string => path;

/** The page language's path localizer (feature 167), or the identity where none was provided. */
export function useCmsRenderLocalizePath(): (path: string) => string {
  return useContext(CmsRenderContext).localizePath ?? identity;
}

/** Feature 169 — the contact form's words in the page language, or `undefined` (English). */
export function useCmsRenderContactFormText(): CmsContactFormText | undefined {
  return useContext(CmsRenderContext).contactFormText;
}

/** Feature 170 — what `forms.Form` reads from the page, or `undefined` (the editor). */
export function useCmsRenderForms(): CmsFormsContext | undefined {
  return useContext(CmsRenderContext).forms;
}

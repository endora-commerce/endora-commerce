import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  formDefinitionSchema,
  type FormDefinition,
  type FormDefinitionInput,
  type FormDetail,
  type FormEntryDetail,
  type FormEntrySummary,
  type FormSummary,
} from '@endora-commerce/contracts';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Shared fixtures of the Forms screen tests (`specs/170-forms-module/` User Story 1, T032).
 *
 * **The screens are rendered over the shipped English bundles**, the module's own `i18n/en.json`
 * and `_i18n`'s, so a test names a control by the sentence an operator reads, through {@link en} —
 * which throws for a key the bundle does not carry.
 */

function shippedBundle(relativePath: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as Record<string, string>;
}

const FORMS_BUNDLE = shippedBundle('../packages/modules/forms/i18n/en.json');
const CORE_BUNDLE = shippedBundle('../packages/modules/_i18n/i18n/en.json');

/** The English sentence of one of the module's own keys. */
export function en(key: string, params: Record<string, string | number> = {}): string {
  const template = FORMS_BUNDLE[key];
  if (template === undefined) throw new Error(`[forms fixtures] the shipped English bundle has no key "${key}".`);
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export const FORM_ID = '00000000-0000-4000-8000-0000000f0001';
export const COPY_ID = '00000000-0000-4000-8000-0000000f0002';
export const LANGUAGE = 'en-US';

/** Mount a screen at `path` (matched against `pattern`) under the real session and presence providers. */
export function renderForms(
  ui: ReactElement,
  options: {
    readonly path?: string;
    readonly pattern?: string;
    readonly permissions?: readonly string[];
    /** The modules present besides `forms` (e.g. `cms`, which a page confirmation needs). */
    readonly present?: readonly string[];
  } = {},
): RenderResult {
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[options.path ?? '/']}>
          <Routes>
            <Route path={options.pattern ?? '*'} element={ui} />
            <Route path="/forms" element={<p>forms list screen</p>} />
            <Route path="/forms/entries" element={<p>entries list screen</p>} />
            <Route path="/forms/entries/:id" element={<p>entry detail screen</p>} />
            <Route path="/forms/:id" element={<p>form builder screen</p>} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: options.permissions ?? ['forms:read', 'forms:write'] }),
        presence: modulePresence({ present: ['forms', ...(options.present ?? [])] }),
        registry: [],
      },
    ),
    { core: CORE_BUNDLE, forms: FORMS_BUNDLE },
  );
}

export function definition(input: Partial<FormDefinitionInput> = {}): FormDefinition {
  return formDefinitionSchema.parse({
    schemaVersion: 1,
    sections: [
      {
        id: 's1',
        columns: 1,
        fields: [
          { id: 'f1', type: 'text', key: 'name' },
          { id: 'f2', type: 'email', key: 'email' },
        ],
      },
      { id: 's2', columns: 1, fields: [{ id: 'f3', type: 'textarea', key: 'message' }] },
    ],
    behaviour: {
      confirmation: { type: 'message' },
      captchaRequired: false,
      confirmationEmail: { enabled: false, includeSummary: false },
    },
    restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
    texts: {
      [LANGUAGE]: {
        'form.title': 'Contact',
        'fields.f1.label': 'Name',
        'fields.f2.label': 'E-mail',
        'fields.f3.label': 'Message',
      },
    },
    ...input,
  });
}

export function summary(overrides: Partial<FormSummary> = {}): FormSummary {
  return {
    id: FORM_ID,
    key: 'contact',
    name: 'Contact',
    status: 'draft',
    defaultLanguage: LANGUAGE,
    publishedVersionNumber: 0,
    entryCount: 0,
    updatedAt: '2026-11-02T10:00:00.000Z',
    warnings: [],
    ...overrides,
  };
}

export function detail(overrides: Partial<FormDetail> = {}): FormDetail {
  return {
    ...summary(),
    definition: definition(),
    recipients: ['shop@example.com'],
    channelRecipients: {},
    retentionDays: null,
    revision: 3,
    publishedDefinition: null,
    ...overrides,
  };
}

export const ENTRY_ID = '00000000-0000-4000-8000-0000000e0001';
export const OTHER_ENTRY_ID = '00000000-0000-4000-8000-0000000e0002';
export const CHANNEL_ID = '00000000-0000-4000-8000-0000000c0001';

export function entrySummary(overrides: Partial<FormEntrySummary> = {}): FormEntrySummary {
  return {
    id: ENTRY_ID,
    formId: FORM_ID,
    formName: 'Contact',
    formVersion: 2,
    status: 'new',
    salesChannelId: CHANNEL_ID,
    language: LANGUAGE,
    submittedAt: '2026-11-01T09:30:00.000Z',
    submitterEmail: 'ada@example.com',
    attributed: false,
    ...overrides,
  };
}

export function entryDetail(overrides: Partial<FormEntryDetail> = {}): FormEntryDetail {
  return {
    ...entrySummary(),
    pageUrl: '/contact?ref=mail',
    answers: [
      { fieldKey: 'name', label: 'Name', type: 'text', value: 'Ada Lovelace' },
      { fieldKey: 'email', label: 'E-mail', type: 'email', value: 'ada@example.com' },
      { fieldKey: 'address', label: 'Address', type: 'address', value: { street: 'Main 1', postalCode: '30-001', city: 'Kraków' } },
      { fieldKey: 'tags', label: 'Interests', type: 'checkboxes', value: ['doors', 'windows'] },
      { fieldKey: 'privacy', label: 'I accept the privacy policy', type: 'privacy_consent', value: true },
    ],
    consents: [{ fieldKey: 'privacy', kind: 'privacy', given: true, text: '<p>I accept the <a href="/privacy">privacy policy</a></p>' }],
    customerAccountId: null,
    organizationId: null,
    notes: [],
    ...overrides,
  };
}

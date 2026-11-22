import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, screen } from '@testing-library/react';
import { useContentDefault } from '@endora-commerce/page-builder-core';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';

/**
 * Issue #1684 — the e-mail builder names the content language it edits to
 * the page builder below it, from the `previewLanguage` its hosts pass (the
 * transactional e-mail's or the campaign's language), so what the builder
 * seeds into the document (the rich text's read-more summary) is in that
 * language. Puck is replaced by a probe that reads the content default where
 * a field would; the pane's reads answer empty.
 */

vi.mock('@puckeditor/core', async () => {
  const actual = await vi.importActual<typeof import('@puckeditor/core')>('@puckeditor/core');
  function Probe(): ReactElement {
    const contentDefault = useContentDefault();
    return <output data-testid="content-default">{contentDefault('readMore.summary')}</output>;
  }
  return { ...actual, Puck: Probe };
});

vi.mock('../../../packages/page-builder-admin/src/chrome/cms-page-builder-api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../packages/page-builder-admin/src/chrome/cms-page-builder-api',
  );
  return {
    ...actual,
    getPageBuilderColorPalette: vi.fn(async () => []),
    getPageBuilderDescriptor: vi.fn(async () => ({ schemaVersion: 1, components: [], categories: [] })),
  };
});

vi.mock('../../../packages/page-builder-admin/src/email/email-templates-api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../packages/page-builder-admin/src/email/email-templates-api',
  );
  return { ...actual, getEmailBranding: vi.fn(async () => ({ logoUrl: '' })) };
});

const { EmailEditorPane } = await import('../../../packages/page-builder-admin/src/email/EmailEditorPane');

afterEach(() => cleanup());

const EMPTY = { root: { props: {} }, content: [] };

describe('the e-mail builder seeds content in the e-mail\'s language (#1684)', () => {
  it.each([
    ['pl-PL', 'en', 'Czytaj więcej'],
    ['en-US', 'pl', 'Read more'],
  ] as const)('a %s e-mail edited in the %s admin', async (previewLanguage, language, expected) => {
    renderWithI18n(
      withSession(
        <EmailEditorPane data={EMPTY} onChange={() => undefined} editorKey="pb1684" previewLanguage={previewLanguage} />,
        {
          session: adminSession({ permissions: ['*'], preferredLanguage: language }),
          presence: modulePresence({ present: ['transactional_emails'] }),
        },
      ),
      shippedCoreBundle(language),
      { language },
    );
    expect((await screen.findByTestId('content-default')).textContent).toBe(expected);
  });
});

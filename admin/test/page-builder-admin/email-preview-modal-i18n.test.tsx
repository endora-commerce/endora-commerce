import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';

/**
 * Issue #1463 (UX audit CONTENT-05) — the e-mail builder's preview modal, which
 * the transactional e-mails and the newsletter both open, named itself, its two
 * widths, its close button and its frame in English whatever the operator's
 * language. Its copy is `core`'s: the pane is the shared builder in
 * `@endora-commerce/page-builder-admin`, which reads no module's bundle.
 */

const { EmailHtmlPreviewModal } = await import('../../../packages/page-builder-admin/src/email/EmailEditorPane');

afterEach(() => cleanup());

describe.each(['en', 'pl'] as const)('the e-mail preview modal in %s', (language) => {
  const core = shippedCoreBundle(language).core as Record<string, string>;
  const key = (k: string): string => {
    const value = core[`pageBuilder.emailPreview.${k}`];
    if (!value) throw new Error(`_i18n/i18n/${language}.json carries no "pageBuilder.emailPreview.${k}"`);
    return value;
  };

  it('names the dialog, the widths, the close button and the frame', () => {
    renderWithI18n(
      <EmailHtmlPreviewModal open html="<p>Hi</p>" onClose={() => undefined} />,
      shippedCoreBundle(language),
      { language },
    );
    expect(screen.getByRole('dialog', { name: key('title') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: key('desktop') })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: key('narrow') })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: key('close') })).toBeInTheDocument();
    expect(screen.getByTitle(key('frameTitle'))).toBeInTheDocument();
  });
});

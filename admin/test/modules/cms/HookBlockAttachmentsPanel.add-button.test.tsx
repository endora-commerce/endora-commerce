import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #1441 (UX audit 2026-11-17, DS-07) — one primary per view. The hook
 * panel's *Add* attaches a block inside an editor; it is an in-editor action,
 * so it is `outline`, not a filled button competing with the screen's primary.
 */

vi.mock('../../../../packages/modules/cms/src/admin/api/cms-client', () => ({
  cmsClient: {
    getHook: async () => ({ attachments: [] }),
    listBlocks: async () => ({ data: [{ id: 'b1', code: 'promo', name: 'Promo' }] }),
  },
}));

const { HookBlockAttachmentsPanel } = await import(
  '../../../../packages/modules/cms/src/admin/components/HookBlockAttachmentsPanel'
);

const HOOK = { id: 'h1', code: 'home.top', name: 'Home top' } as never;

describe('HookBlockAttachmentsPanel — the in-editor Add is outline (DS-07)', () => {
  it('draws Add as an outline button, not a filled one', async () => {
    renderWithI18n(<HookBlockAttachmentsPanel hook={HOOK} />, passthroughBundle('cms', ['hookAttachments.addBlock']));
    const add = await screen.findByRole('button', { name: /common\.add/ });
    expect(add.className.split(/\s+/)).not.toContain('bg-primary');
    expect(add.className.split(/\s+/)).toContain('border-input');
  });
});

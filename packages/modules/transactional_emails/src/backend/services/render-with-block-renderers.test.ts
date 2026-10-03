import type { EmailBlockRenderers } from '@endora-commerce/email-components/render/block-renderers';
import { describe, expect, it, vi } from 'vitest';

import { renderTransactionalEmail } from './render-transactional-email.js';

/**
 * `specs/141-module-block-renderers/` FR-009, FR-012, FR-015 — the
 * transactional send path renders a module's contributed e-mail block, drops it
 * while its owner is absent, and survives a renderer that throws.
 *
 * `blockRenderers` is a function because presence is answered per render: the
 * composition hands the service `registry.renderers`, and that table leaves out
 * a module an operator switched off.
 */

const content = {
  root: { props: {} },
  content: [
    { type: 'transactional_emails.EmailText', props: { id: 't1', text: 'Hello {{var name}}' } },
    { type: 'crm.Badge', props: { id: 'b1', text: 'Gold' } },
  ],
  zones: {},
};

const badge: EmailBlockRenderers = {
  'crm.Badge': {
    html: (props: { text?: string }) => `<tr><td>crm-badge:${String(props.text)} {{var name}}</td></tr>`,
    text: (props: { text?: string }) => `crm-badge-text:${String(props.text)} {{var name}}\n`,
  },
};

const base = {
  subject: 'Order for {{var name}}',
  content,
  embeds: { blocks: {}, templates: {} },
  branding: { logoUrl: '', accentColor: '#123456' },
  variables: { name: 'Ada' },
  language: 'en-US',
};

describe('renderTransactionalEmail with contributed block renderers', () => {
  it('renders a registered block in HTML and text, with its directives resolved', () => {
    const out = renderTransactionalEmail({ ...base, blockRenderers: () => badge });
    expect(out.subject).toBe('Order for Ada');
    expect(out.html).toContain('Hello Ada');
    expect(out.html).toContain('crm-badge:Gold Ada');
    expect(out.text).toContain('crm-badge-text:Gold Ada');
  });

  it('renders nothing of the block when its owner is reported absent', () => {
    // What `EmailBlockRendererRegistry.renderers()` answers for an owner that
    // is switched off: a table without the block.
    const out = renderTransactionalEmail({ ...base, blockRenderers: () => ({}) });
    expect(out.html).toContain('Hello Ada');
    expect(out.html).not.toContain('crm-badge');
    expect(out.text).not.toContain('crm-badge');
  });

  it('reads the table on every render, so a module switched back on renders again', () => {
    let present = false;
    const blockRenderers = (): EmailBlockRenderers => (present ? badge : {});
    expect(renderTransactionalEmail({ ...base, blockRenderers }).html).not.toContain('crm-badge');
    present = true;
    expect(renderTransactionalEmail({ ...base, blockRenderers }).html).toContain('crm-badge:Gold');
  });

  it('still renders the message when a renderer throws, and reports the block with its owner', () => {
    const boom = new Error('boom');
    const onBlockFailure = vi.fn();
    const out = renderTransactionalEmail({
      ...base,
      blockRenderers: () => ({
        'crm.Badge': {
          html: () => {
            throw boom;
          },
        },
      }),
      onBlockFailure,
    });
    expect(out.html).toContain('Hello Ada');
    expect(out.text).toContain('Hello Ada');
    // Once per output the block was asked for: the HTML and the text.
    expect(onBlockFailure).toHaveBeenCalledTimes(2);
    expect(onBlockFailure).toHaveBeenCalledWith({ block: 'crm.Badge', owner: 'crm', error: boom });
  });

  it('renders as before when no table is wired', () => {
    const out = renderTransactionalEmail(base);
    expect(out.html).toContain('Hello Ada');
    expect(out.html).not.toContain('crm-badge');
  });
});

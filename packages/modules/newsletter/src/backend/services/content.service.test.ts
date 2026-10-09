import { describe, it, expect, vi } from 'vitest';
import type { EmailBlockRenderers } from '@endora-commerce/email-components/render/block-renderers';
import {
  NewsletterContentService,
  renderNewsletterEmail,
  withEmailBranding,
} from './content.service.js';

/**
 * A minimal Puck-style content tree the email renderer understands: a single
 * text component carrying a directive. Mirrors the envelope shape produced by
 * the admin editor.
 */
function textTree(text: string): Record<string, unknown> {
  return {
    root: { props: {} },
    content: [{ type: 'transactional_emails.EmailText', props: { id: 't1', text } }],
    zones: {},
  };
}

describe('renderNewsletterEmail', () => {
  const baseContext = {
    variables: { subscriber: { firstName: 'Ada' }, customFields: { city: 'Kraków' } },
    unsubscribeUrl: 'https://shop.example/newsletter/unsubscribe?token=abc',
  };

  it('substitutes variables in subject and body', () => {
    const out = renderNewsletterEmail({
      subject: 'Hello {{var subscriber.firstName}}',
      content: textTree('Greetings from {{var customFields.city}}'),
      context: baseContext,
    });
    expect(out.subject).toBe('Hello Ada');
    expect(out.html).toContain('Greetings from Kraków');
    expect(out.text).toContain('Greetings from Kraków');
  });

  it('resolves a missing variable to empty without leaking the placeholder', () => {
    const out = renderNewsletterEmail({
      subject: 'Hi {{var subscriber.lastName}}',
      content: textTree('Welcome {{var subscriber.lastName}}'),
      context: baseContext,
    });
    expect(out.subject).toBe('Hi ');
    expect(out.html).not.toContain('{{');
    expect(out.text).not.toContain('{{');
  });

  it('exposes the mandatory unsubscribe url to the directive context', () => {
    const out = renderNewsletterEmail({
      subject: 'x',
      content: textTree('<a href="{{var unsubscribeUrl}}">unsub</a>'),
      context: baseContext,
    });
    expect(out.text).toContain('https://shop.example/newsletter/unsubscribe');
  });

  it('always produces an HTML document and a plain-text alternative', () => {
    const out = renderNewsletterEmail({
      subject: 'x',
      content: textTree('Body'),
      context: baseContext,
    });
    expect(out.html).toContain('<!DOCTYPE html>');
    expect(out.text.length).toBeGreaterThan(0);
  });

  it('renders EmailSection + EmailRichText trees with directives', () => {
    const content = {
      root: { props: {} },
      content: [
        {
          type: 'transactional_emails.EmailSection',
          props: { id: 'sec', backgroundColor: '#ffffff', paddingY: 8, paddingX: 16 },
        },
      ],
      zones: {
        'sec:content': [
          {
            type: 'transactional_emails.EmailRichText',
            props: {
              content: null,
              html: '<p>Hello {{var subscriber.firstName}}</p>',
              align: 'left',
            },
          },
        ],
      },
    };
    const out = renderNewsletterEmail({
      subject: 'x',
      content,
      context: baseContext,
    });
    expect(out.html).toContain('Hello Ada');
    expect(out.text).toContain('Hello Ada');
  });
});

describe('withEmailBranding', () => {
  it('merges logoUrl and accent into variables when a resolver is provided', async () => {
    const out = await withEmailBranding(
      { subscriber: { email: 'a@b.c' } },
      'channel-1',
      async () => ({ logoUrl: 'https://cdn/logo.png', accentColor: '#112233' }),
    );
    expect(out.accentColor).toBe('#112233');
    expect(out.variables).toEqual({
      subscriber: { email: 'a@b.c' },
      branding: { logoUrl: 'https://cdn/logo.png', accentColor: '#112233' },
    });
  });

  // Issue #121. The ORM hydrates a NULL column as `undefined`, so "no channel"
  // reaches this function as either; a branding source reads settings with the
  // id it is given, and that seam refuses anything but a uuid or `null`.
  it.each([[null], [undefined]])(
    'reads the default sales channel when the owner has none (%s)',
    async (salesChannelId) => {
      const asked: Array<string | null> = [];
      const out = await withEmailBranding(
        {},
        salesChannelId,
        async (id) => {
          asked.push(id);
          return { logoUrl: '', accentColor: '#abcdef' };
        },
        async () => 'default-channel',
      );
      expect(asked).toEqual(['default-channel']);
      expect(out.accentColor).toBe('#abcdef');
    },
  );

  it('reads platform-wide, with null, when no default channel can be named', async () => {
    const asked: Array<string | null> = [];
    const resolve = async (id: string | null) => {
      asked.push(id);
      return { logoUrl: '', accentColor: '#abcdef' };
    };
    await withEmailBranding({}, undefined, resolve);
    await withEmailBranding({}, undefined, resolve, async () => null);
    expect(asked).toEqual([null, null]);
  });

  it('does not ask for the default channel when the owner has its own', async () => {
    const asked: Array<string | null> = [];
    await withEmailBranding(
      {},
      'channel-1',
      async (id) => {
        asked.push(id);
        return { logoUrl: '', accentColor: '#abcdef' };
      },
      async () => {
        throw new Error('the default channel was resolved for a campaign that has one');
      },
    );
    expect(asked).toEqual(['channel-1']);
  });

  it('leaves variables unchanged when no resolver is provided', async () => {
    const vars = { subscriber: { email: 'a@b.c' } };
    const out = await withEmailBranding(vars, null);
    expect(out.variables).toBe(vars);
    expect(out.accentColor).toBeUndefined();
  });
});

/**
 * `specs/141-module-block-renderers/` FR-009, FR-012, FR-015 — a campaign that
 * contains a module's contributed block.
 */
describe('NewsletterContentService with contributed block renderers', () => {
  const context = {
    variables: { subscriber: { firstName: 'Ada' } },
    unsubscribeUrl: 'https://shop.example/newsletter/unsubscribe?token=abc',
  };
  const content = {
    root: { props: {} },
    content: [
      { type: 'transactional_emails.EmailText', props: { id: 't1', text: 'Hi {{var subscriber.firstName}}' } },
      { type: 'crm.Badge', props: { id: 'b1', text: 'Gold' } },
    ],
    zones: {},
  };
  const badge: EmailBlockRenderers = {
    'crm.Badge': {
      html: (props: { text?: string }) =>
        `<tr><td>crm-badge:${String(props.text)} {{var subscriber.firstName}}</td></tr>`,
      text: (props: { text?: string }) => `crm-badge-text:${String(props.text)}\n`,
    },
  };

  it('renders a registered block in HTML and text, with its directives resolved', () => {
    const service = new NewsletterContentService({ blockRenderers: () => badge });
    const out = service.render({ subject: 'News', content, context });
    expect(out.html).toContain('crm-badge:Gold Ada');
    expect(out.text).toContain('crm-badge-text:Gold');
  });

  it('renders nothing of the block when its owner is reported absent', () => {
    const service = new NewsletterContentService({ blockRenderers: () => ({}) });
    const out = service.render({ subject: 'News', content, context });
    expect(out.html).toContain('Hi Ada');
    expect(out.html).not.toContain('crm-badge');
    expect(out.text).not.toContain('crm-badge');
  });

  it('still renders the message when a renderer throws, and reports the block with its owner', () => {
    const boom = new Error('boom');
    const onBlockFailure = vi.fn();
    const service = new NewsletterContentService({
      blockRenderers: () => ({
        'crm.Badge': {
          html: () => {
            throw boom;
          },
        },
      }),
      onBlockFailure,
    });
    const out = service.render({ subject: 'News', content, context });
    expect(out.html).toContain('Hi Ada');
    expect(out.text).toContain('Hi Ada');
    expect(onBlockFailure).toHaveBeenCalledWith({ block: 'crm.Badge', owner: 'crm', error: boom });
  });

  it('renders as before when constructed with nothing', () => {
    const out = new NewsletterContentService().render({ subject: 'News', content, context });
    expect(out.html).toContain('Hi Ada');
    expect(out.html).not.toContain('crm-badge');
  });
});

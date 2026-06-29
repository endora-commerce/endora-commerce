import { describe, it, expect } from 'vitest';
import { renderNewsletterEmail } from './content.service.js';

/**
 * A minimal Puck-style content tree the email renderer understands: a single
 * text component carrying a directive. Mirrors the envelope shape produced by
 * the admin editor.
 */
function textTree(text: string): Record<string, unknown> {
  return {
    root: { props: {} },
    content: [{ type: 'EmailText', props: { id: 't1', text } }],
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
});

import { describe, expect, it } from 'vitest';
import { renderDirectives } from '../directives/directive-engine.js';
import type { PuckDataTree } from '../schema/envelope.js';
import { renderEmailHtml } from './render-email-html.js';
import { renderEmailText } from './render-email-text.js';

/**
 * A button whose address is one variable is dropped while that variable is
 * empty or unset, in both parts (the follow-up to issue #185).
 *
 * An operator e-mail links into the admin panel only when `ADMIN_BASE_URL` is
 * configured, so its sender leaves the link variable out otherwise. A button
 * rendered anyway would point at `#` in the HTML part — a control that opens
 * nothing — and read "Open the task" with no address in the text part. The
 * same guard as the unsubscribe anchor's (issue #520), at render time, so a
 * seeded template and an operator-edited one behave alike.
 */

const tree = (content: unknown[]): PuckDataTree => ({ root: { props: {} }, content, zones: {} });

const button = (href: string) =>
  tree([
    { type: 'transactional_emails.EmailText', props: { text: 'Body', align: 'left' } },
    { type: 'transactional_emails.EmailButton', props: { label: 'Open the task', href, align: 'left' } },
  ]);

const html = (t: PuckDataTree, ctx: Record<string, unknown>) => renderDirectives(renderEmailHtml(t), ctx, { escape: true });
const text = (t: PuckDataTree, ctx: Record<string, unknown>) => renderDirectives(renderEmailText(t), ctx);

describe('a button whose address is one variable', () => {
  it('renders, with that address, while the variable is set', () => {
    const ctx = { task: { adminUrl: 'https://admin.example.com/tasks/t1' } };
    expect(html(button('{{var task.adminUrl}}'), ctx)).toContain('href="https://admin.example.com/tasks/t1"');
    expect(html(button('{{var task.adminUrl}}'), ctx)).toContain('Open the task');
    expect(text(button('{{var task.adminUrl}}'), ctx)).toContain('Open the task: https://admin.example.com/tasks/t1');
  });

  it('is dropped from both parts while the variable is unset or empty', () => {
    for (const ctx of [{}, { task: { adminUrl: '' } }]) {
      const rendered = html(button('{{ var task.adminUrl }}'), ctx);
      expect(rendered).toContain('Body');
      expect(rendered).not.toContain('Open the task');
      expect(rendered).not.toContain('href="#"');
      expect(text(button('{{var task.adminUrl}}'), ctx)).not.toContain('Open the task');
    }
  });

  it('leaves a literal address, or one that only contains a variable, as it was', () => {
    expect(html(button('https://example.com/a'), {})).toContain('href="https://example.com/a"');
    expect(html(button('https://example.com/{{var id}}'), {})).toContain('href="https://example.com/"');
  });
});

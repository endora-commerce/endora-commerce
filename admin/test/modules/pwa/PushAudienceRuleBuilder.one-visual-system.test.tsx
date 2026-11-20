import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState, type ReactNode } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PushAudienceRule } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1492 (UX audit CAT-17) — the push audience rule builder drew its
 * frames, its AND / OR switch and its value picker with `b2b-*` classes and
 * inline colours (a white-on-primary operator button hard-coded `#fff`). The
 * value picker's options were `<li onClick>`s: a mouse could pick one, a
 * keyboard could not (WCAG 2.1.1). It draws kit primitives now, and each
 * option is a labelled checkbox.
 */
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as Record<string, string>;
const pwa = read('../packages/modules/pwa/i18n/en.json');
const core = read('../packages/modules/_i18n/i18n/en.json');
const p = (key: string): string => {
  const value = pwa[key];
  if (value === undefined) throw new Error(`missing pwa key ${key}`);
  return value;
};

const get = vi.fn<(url: string) => Promise<unknown>>();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (url: string) => get(url), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});

const CHANNELS = {
  data: {
    items: [
      { id: 'ch-1', code: 'b2b', name: 'Wholesale' },
      { id: 'ch-2', code: 'b2c', name: 'Retail' },
    ],
  },
};

let latest: PushAudienceRule = { kind: 'all' };

async function mount(initial: PushAudienceRule): Promise<void> {
  const { PushAudienceRuleBuilder } = await import(
    '../../../../packages/modules/pwa/src/admin/components/PushAudienceRuleBuilder'
  );
  function Host(): ReactNode {
    const [value, setValue] = useState<PushAudienceRule>(initial);
    return (
      <PushAudienceRuleBuilder
        value={value}
        onChange={(next): void => {
          latest = next;
          setValue(next);
        }}
      />
    );
  }
  renderWithI18n(<Host />, { pwa, core });
}

const GROUP: PushAudienceRule = {
  kind: 'group',
  op: 'AND',
  children: [{ kind: 'criterion', type: 'salesChannel', values: [] }],
};

beforeEach(() => {
  get.mockReset();
  latest = { kind: 'all' };
});

describe('push audience rule builder (#1492)', () => {
  it('lets a keyboard pick a value: every option is a labelled checkbox', async () => {
    get.mockResolvedValue(CHANNELS);
    await mount(GROUP);
    fireEvent.click(screen.getByRole('button', { name: p('audience.pickValues') }));
    const retail = await screen.findByRole('checkbox', { name: /Retail/ });
    expect(retail).not.toBeChecked();
    fireEvent.click(retail);
    expect(retail).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: p('audience.apply').replace('{count}', '1') }));
    await waitFor(() =>
      expect(latest).toEqual({
        kind: 'group',
        op: 'AND',
        children: [{ kind: 'criterion', type: 'salesChannel', values: ['ch-2'] }],
      }),
    );
  });

  it('announces the options loading as a status', async () => {
    get.mockImplementation(() => new Promise(() => undefined));
    await mount(GROUP);
    fireEvent.click(screen.getByRole('button', { name: p('audience.pickValues') }));
    expect(await screen.findByRole('status')).toHaveTextContent(p('audience.loading'));
  });

  it('shows a failed option load as an alert', async () => {
    get.mockRejectedValue(new Error('down'));
    await mount(GROUP);
    fireEvent.click(screen.getByRole('button', { name: p('audience.pickValues') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(p('audience.loadError'));
  });

  it('switches AND / OR through kit buttons that announce which is on', async () => {
    get.mockResolvedValue(CHANNELS);
    await mount(GROUP);
    const operator = screen.getByRole('group', { name: p('audience.operator') });
    const and = within(operator).getByRole('button', { name: p('audience.op.AND') });
    const or = within(operator).getByRole('button', { name: p('audience.op.OR') });
    expect(and.getAttribute('aria-pressed')).toBe('true');
    expect(and.getAttribute('style')).toBeNull();
    fireEvent.click(or);
    await waitFor(() => expect(or.getAttribute('aria-pressed')).toBe('true'));
    expect(and.getAttribute('aria-pressed')).toBe('false');
  });

  it('adds the first criterion from the empty rule with an outline button: it applies at once', async () => {
    get.mockResolvedValue(CHANNELS);
    await mount({ kind: 'all' });
    const add = screen.getByRole('button', { name: p('audience.addCriterion') });
    expect(add.className).toContain('border-input');
    fireEvent.click(add);
    await waitFor(() => expect(latest.kind).toBe('group'));
  });
});

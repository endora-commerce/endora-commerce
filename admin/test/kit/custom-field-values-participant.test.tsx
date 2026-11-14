import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState, type ReactElement } from 'react';
import type { SaveOutcome } from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * Feature 180, WP-5 — `CustomFieldValuesPanel` under a page Save (FR-062, owner ruling
 * OQ-11 = A). Given a `saveSession` it takes part as a **host-owned section** under the
 * provider's `hostModule` and renders no Save of its own; the host's `save` is still the write.
 * Without one it is the standalone panel it always was (`kit-custom-field-values.test.tsx`
 * holds that behaviour; one case here pins the button).
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { CustomFieldValuesPanel } = await import('@endora-commerce/admin-kit/components');
const { SaveSessionProvider, useSaveSession } = await import('@endora-commerce/admin-kit/lib');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

function definition(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-00000000d001',
    entityType: 'customer',
    key: 'loyalty_tier',
    label: { en: 'Loyalty tier' },
    labelDefault: 'Loyalty tier',
    valueType: 'text',
    required: false,
    sortOrder: 0,
    config: {},
    options: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const STORED = { loyalty_tier: 'gold', internal_note: 'kept' };

let outcome: SaveOutcome | null = null;

function Host({ save }: { save: (values: Record<string, unknown>) => Promise<void> }): ReactElement {
  const session = useSaveSession();
  // The stored bag is the host's state: stable between renders, as `loaded` requires.
  const [values] = useState<Record<string, unknown>>(STORED);
  return (
    <div>
      <output data-testid="count">{session.dirtyCount}</output>
      <output data-testid="ids">
        {session
          .dirtyParticipants()
          .map((part) => part.id)
          .join(',')}
      </output>
      <button
        type="button"
        onClick={() => {
          void session.run(null).then((result) => {
            outcome = result;
          });
        }}
      >
        page save
      </button>
      <CustomFieldValuesPanel entityType="customer" values={values} save={save} saveSession={session.handle} />
    </div>
  );
}

function wrap(ui: ReactElement): ReactElement {
  return (
    <TranslationProvider language="en" initialBundle={{ core: CORE_EN }}>
      {withSession(<SaveSessionProvider resetKey="c1" hostModule="customers">{ui}</SaveSessionProvider>, {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['customers'] }),
      })}
    </TranslationProvider>
  );
}

beforeEach(() => {
  getSpy.mockReset();
  outcome = null;
  getSpy.mockResolvedValue({
    data: [
      definition(),
      definition({ id: '00000000-0000-4000-8000-00000000d002', key: 'internal_note', adminAccess: 'read' }),
    ],
  });
});

describe('CustomFieldValuesPanel with a save session', () => {
  it('renders no Save of its own and registers its edits under the host module', async () => {
    const save = vi.fn(async () => undefined);
    render(wrap(<Host save={save} />));
    const input = (await screen.findByLabelText('Loyalty tier')) as HTMLInputElement;
    expect(screen.queryByRole('button', { name: CORE_EN['customFields.save'] as string })).toBeNull();
    expect(screen.getByTestId('count').textContent).toBe('0');

    fireEvent.change(input, { target: { value: 'platinum' } });

    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('ids').textContent).toBe('customers:custom-fields');
    expect(save).not.toHaveBeenCalled();
  });

  it('is written by the page Save, through the host’s save, with the edit-level keys only', async () => {
    const save = vi.fn(async () => undefined);
    render(wrap(<Host save={save} />));
    fireEvent.change(await screen.findByLabelText('Loyalty tier'), { target: { value: 'platinum' } });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    fireEvent.click(screen.getByRole('button', { name: 'page save' }));

    await waitFor(() => expect(outcome?.result).toBe('saved'));
    expect(save).toHaveBeenCalledWith({ loyalty_tier: 'platinum' });
    expect(outcome?.parts[0]?.label).toBe(CORE_EN['customFields.title']);
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('keeps the edit staged and shows the field refusal when the write is refused', async () => {
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    const save = vi.fn(async () => {
      throw new ApiError(422, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid custom field values',
          details: [{ path: 'loyalty_tier', issue: 'Too long' }],
        },
      });
    });
    render(wrap(<Host save={save} />));
    fireEvent.change(await screen.findByLabelText('Loyalty tier'), { target: { value: 'x'.repeat(300) } });

    fireEvent.click(screen.getByRole('button', { name: 'page save' }));

    await waitFor(() => expect(outcome?.result).toBe('failed'));
    expect(screen.getByText('Too long')).toBeTruthy();
    expect(screen.getByTestId('count').textContent).toBe('1');
  });
});

describe('CustomFieldValuesPanel without a save session (unchanged, OQ-11 = A)', () => {
  it('keeps its own Save', async () => {
    const save = vi.fn(async () => undefined);
    render(
      <TranslationProvider language="en" initialBundle={{ core: CORE_EN }}>
        <CustomFieldValuesPanel entityType="customer" values={STORED} save={save} />
      </TranslationProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Loyalty tier'), { target: { value: 'platinum' } });
    fireEvent.click(screen.getByRole('button', { name: CORE_EN['customFields.save'] as string }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ loyalty_tier: 'platinum' }));
  });
});

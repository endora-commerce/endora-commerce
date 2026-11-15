import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect, useState, type ReactElement } from 'react';
import type { AdminZoneContribution, AdminZoneProps } from '@endora-commerce/contracts';
import {
  ApiError,
  INERT_SAVE_SESSION,
  SaveSessionProvider,
  useModulePresence,
  useSaveParticipant,
  useSaveSession,
  type SaveOutcome,
  type SavePart,
  type SaveParticipantHandlers,
} from '@endora-commerce/admin-kit/lib';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * Feature 180 — the save session and its two hooks
 * (`specs/180-one-save-zone-editors/contracts/save-participation.md` §2–§3, data-model.md;
 * FR-001…FR-006, FR-034).
 *
 * Every case drives the **real** zone renderer (`<AdminZone>`), the real presence and auth
 * providers and the real translation provider: a participant's module is read from the zone
 * contribution that rendered it, and presence is decided by the same predicate the zone uses.
 */

const BUNDLE = {
  core: {
    'saveSession.notice.moduleOff': 'moduleOff:{label}',
    'saveSession.notice.crashed': 'crashed:{label}',
    'saveSession.error.moduleOff': 'switched off',
  },
};

// ---------------------------------------------------------------------------
// The test-only participant, contributed by a module called `test_prices`.
// ---------------------------------------------------------------------------

interface PricesDraft {
  readonly amount: string;
}

/** What the panel is handed, set per case. */
const panel: {
  loaded: PricesDraft | null;
  writable: boolean;
  crash: boolean;
  handlers: SaveParticipantHandlers<PricesDraft>;
} = {
  loaded: { amount: '10' },
  writable: true,
  crash: false,
  handlers: defaultHandlers(),
};

function defaultHandlers(): SaveParticipantHandlers<PricesDraft> {
  return {
    changeCount: (draft, baseline) => (draft.amount === baseline.amount ? 0 : 1),
    validate: vi.fn(async () => ({ fields: {} })),
    save: vi.fn(async (draft: PricesDraft) => draft),
  };
}

function PricesPanel(props: AdminZoneProps<'product.editor.pricing.before'>): ReactElement {
  if (panel.crash) throw new Error('contribution crashed');
  const participant = useSaveParticipant(
    props.saveSession,
    { key: 'prices', label: 'Prices', writable: panel.writable, loaded: panel.loaded },
    panel.handlers,
  );
  if (participant.draft === null) return <p>loading</p>;
  return (
    <div>
      <label>
        Amount
        <input
          value={participant.draft.amount}
          onChange={(event) => participant.setDraft({ amount: event.target.value })}
        />
      </label>
      <span data-testid="status">{participant.status}</span>
      {participant.issues?.fields['amount'] ? <span role="alert">{participant.issues.fields['amount']}</span> : null}
      {participant.error ? <span data-testid="part-error">{participant.error}</span> : null}
    </div>
  );
}

const PRICES_CONTRIBUTION: AdminZoneContribution = {
  zone: 'product.editor.pricing.before',
  weight: 0,
  component: () => Promise.resolve({ default: PricesPanel }),
};

// ---------------------------------------------------------------------------
// The test-only host.
// ---------------------------------------------------------------------------

let lastOutcome: SaveOutcome | null = null;
let hostPart: SavePart | null = null;

// `loaded` and the handlers are what a real section holds in state: stable between renders.
const NOTES_LOADED: PricesDraft = { amount: '' };
const NOTES_HANDLERS = defaultHandlers();

function HostSection(): ReactElement {
  const participant = useSaveParticipant(
    useSaveSession().handle,
    { key: 'notes', label: 'Notes', writable: true, loaded: NOTES_LOADED },
    NOTES_HANDLERS,
  );
  return (
    <label>
      Notes
      <input
        value={participant.draft?.amount ?? ''}
        onChange={(event) => participant.setDraft({ amount: event.target.value })}
      />
    </label>
  );
}

function PresenceRefresh(): ReactElement {
  const { refresh } = useModulePresence();
  return (
    <button type="button" onClick={() => void refresh()}>
      refresh presence
    </button>
  );
}

function HostBody({ withHostSection }: { withHostSection: boolean }): ReactElement {
  const session = useSaveSession();
  const [showZone, setShowZone] = useState(true);
  return (
    <div>
      <output data-testid="count">{session.dirtyCount}</output>
      <output data-testid="outcome">{session.lastOutcome?.result ?? ''}</output>
      <output data-testid="zone">{session.zoneOf('test_prices:prices') ?? ''}</output>
      <output data-testid="ids">
        {session
          .dirtyParticipants()
          .map((part) => part.id)
          .join(',')}
      </output>
      <ul aria-label="notices">
        {session.notices.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>
      <button type="button" onClick={() => setShowZone((shown) => !shown)}>
        toggle zone
      </button>
      <button
        type="button"
        onClick={() => {
          void session.run(hostPart).then((outcome) => {
            lastOutcome = outcome;
          });
        }}
      >
        save
      </button>
      <button type="button" onClick={session.discardAll}>
        discard
      </button>
      {withHostSection ? <HostSection /> : null}
      {showZone ? (
        <AdminZone name="product.editor.pricing.before" props={{ productId: 'p1', saveSession: session.handle }} />
      ) : null}
    </div>
  );
}

function Host({
  resetKey = 'global',
  hostModule,
  withHostSection = false,
}: {
  resetKey?: string;
  hostModule?: string;
  withHostSection?: boolean;
}): ReactElement {
  return (
    <SaveSessionProvider resetKey={resetKey} {...(hostModule === undefined ? {} : { hostModule })}>
      <PresenceRefresh />
      <HostBody withHostSection={withHostSection} />
    </SaveSessionProvider>
  );
}

function wrap(ui: ReactElement, permissions: readonly string[] = ['*']): ReactElement {
  return (
    <TranslationProvider language="en" initialBundle={BUNDLE}>
      {withSession(ui, {
        session: adminSession({ permissions }),
        presence: modulePresence({ present: ['test_prices', 'catalog'] }),
        contributions: [{ moduleId: 'test_prices', contributions: { zones: [PRICES_CONTRIBUTION] } }],
      })}
    </TranslationProvider>
  );
}

function renderHost(props: Parameters<typeof Host>[0] = {}): ReturnType<typeof render> {
  return render(wrap(<Host {...props} />));
}

const count = (): string => screen.getByTestId('count').textContent ?? '';

async function amountInput(): Promise<HTMLInputElement> {
  return (await screen.findByLabelText('Amount')) as HTMLInputElement;
}

afterEach(() => {
  panel.loaded = { amount: '10' };
  panel.writable = true;
  panel.crash = false;
  panel.handlers = defaultHandlers();
  lastOutcome = null;
  hostPart = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSaveParticipant inside a zone', () => {
  it('registers under the contributing module and is counted by the host', async () => {
    renderHost();
    const input = await amountInput();
    expect(count()).toBe('0');

    fireEvent.change(input, { target: { value: '12' } });

    expect(count()).toBe('1');
    expect(screen.getByTestId('ids').textContent).toBe('test_prices:prices');
    expect(screen.getByTestId('status').textContent).toBe('dirty');
  });

  it('keeps a dirty draft when the panel unmounts and shows it again on remount (FR-003)', async () => {
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });

    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(count()).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));
    expect((await amountInput()).value).toBe('12');
    expect(count()).toBe('1');
  });

  it('keeps a dirty draft through a remount that is still loading and not yet writable', async () => {
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));

    // The remounted panel has not read yet: nothing loaded, and so not writable either.
    panel.loaded = null;
    panel.writable = false;
    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));
    expect((await amountInput()).value).toBe('12');
    expect(count()).toBe('1');
  });

  it('removes a clean entry on unmount, so a remount seeds from what it loads', async () => {
    renderHost();
    await amountInput();
    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));
    expect(screen.getByTestId('ids').textContent).toBe('');

    panel.loaded = { amount: '20' };
    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));
    expect((await amountInput()).value).toBe('20');
  });

  it('does not let a fresh read overwrite a dirty draft', async () => {
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));

    panel.loaded = { amount: '30' };
    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));
    expect((await amountInput()).value).toBe('12');
  });

  it('is never dirty when it may not write', async () => {
    panel.writable = false;
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });
    expect(count()).toBe('0');
    expect(screen.getByTestId('status').textContent).toBe('clean');
  });

  it('a module switched off while dirty is dropped with a notice (FR-034)', async () => {
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });
    expect(count()).toBe('1');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(modulePresence({ present: ['catalog'], absent: ['test_prices'] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'refresh presence' }));

    await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());
    await waitFor(() => expect(count()).toBe('0'));
    expect(screen.getByRole('list', { name: 'notices' }).textContent).toContain('moduleOff:Prices');
  });

  it('a contribution that crashes is dropped with a notice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });

    panel.crash = true;
    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle zone' }));

    await waitFor(() => expect(count()).toBe('0'));
    expect(screen.getByRole('list', { name: 'notices' }).textContent).toContain('crashed:Prices');
  });

  it('a new resetKey starts an empty session (OQ-4 = A)', async () => {
    const view = renderHost({ resetKey: 'global' });
    fireEvent.change(await amountInput(), { target: { value: '12' } });
    expect(count()).toBe('1');

    view.rerender(wrap(<Host resetKey="b2b-pl" />));
    await waitFor(() => expect(count()).toBe('0'));
    expect((await amountInput()).value).toBe('10');
  });

  it('discardAll puts every draft back to its saved state', async () => {
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'discard' }));
    expect(count()).toBe('0');
    expect((await amountInput()).value).toBe('10');
  });
});

describe('host-owned sections (FR-006)', () => {
  it('register under the provider’s hostModule', async () => {
    renderHost({ hostModule: 'catalog', withHostSection: true });
    fireEvent.change(await screen.findByLabelText('Notes'), { target: { value: 'hello' } });
    fireEvent.change(await amountInput(), { target: { value: '12' } });
    // Host-owned sections sort before zone participants.
    expect(screen.getByTestId('ids').textContent).toBe('catalog:notes,test_prices:prices');
    expect(count()).toBe('2');
  });

  it('are refused with a developer error when the provider has no hostModule', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHost({ withHostSection: true })).toThrow(/hostModule/);
  });
});

describe('an edit made before the seed effect has run (#407)', () => {
  /**
   * The participant seeds the session from `loaded` in a passive effect. A loaded test runner (or
   * a slow machine) lets the commit that first shows the control reach the operator before that
   * effect runs, and an edit in that window used to be dropped: there was no entry yet to record
   * it in. A layout effect runs in exactly that window, so it stands in for the operator here.
   */
  it('seeds the part and keeps the edit', async () => {
    const loaded: PricesDraft = { amount: '1' };
    const handlers = defaultHandlers();
    let observed: ReturnType<typeof useSaveSession> | null = null;
    function Early(): ReactElement {
      const session = useSaveSession();
      observed = session;
      const participant = useSaveParticipant(
        session.handle,
        { key: 'early', label: 'Early', writable: true, loaded },
        handlers,
      );
      const { setDraft } = participant;
      const [done, setDone] = useState(false);
      useLayoutEffect(() => {
        if (done) return;
        setDone(true);
        setDraft({ amount: '2' });
      }, [done, setDraft]);
      return <input aria-label="Early" readOnly value={participant.draft?.amount ?? ''} />;
    }
    render(
      wrap(
        <SaveSessionProvider resetKey="early" hostModule="catalog">
          <Early />
        </SaveSessionProvider>,
      ),
    );
    await waitFor(() => expect((screen.getByLabelText('Early') as HTMLInputElement).value).toBe('2'));
    expect(observed!.dirtyCount).toBe(1);
    expect(observed!.dirtyParticipants().map((part) => part.id)).toEqual(['catalog:early']);
  });
});

describe('useSaveSession().run', () => {
  it('hands validate and save the baseline the draft is compared to (feature 180, WP-3)', async () => {
    const validate = vi.fn(async () => ({ fields: {} }));
    const save = vi.fn(async (draft: PricesDraft) => draft);
    panel.handlers = { ...defaultHandlers(), validate, save };
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(lastOutcome?.result).toBe('saved'));
    expect(validate).toHaveBeenCalledWith({ amount: '12' }, expect.objectContaining({ signal: expect.any(AbortSignal) }), { amount: '10' });
    expect(save).toHaveBeenCalledWith({ amount: '12' }, expect.objectContaining({ signal: expect.any(AbortSignal) }), { amount: '10' });
  });

  it('names the zone a participant rendered in, so the host can take the operator to it', async () => {
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });
    expect(screen.getByTestId('zone').textContent).toBe('product.editor.pricing.before');
  });

  it('validates and writes each dirty participant, then marks it clean at the returned baseline', async () => {
    const save = vi.fn(async (draft: PricesDraft) => ({ amount: `${draft.amount}.00` }));
    panel.handlers = { ...defaultHandlers(), save };
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(lastOutcome?.result).toBe('saved'));
    expect(save).toHaveBeenCalledWith({ amount: '12' }, expect.objectContaining({ signal: expect.any(AbortSignal) }), { amount: '10' });
    expect(panel.handlers.validate).toHaveBeenCalledTimes(1);
    expect(count()).toBe('0');
    expect((await amountInput()).value).toBe('12.00');
  });

  it('a refusal writes nothing and puts the issues on the participant', async () => {
    const validate = vi.fn(async () => ({ fields: { amount: 'Too many decimals' } }));
    panel.handlers = { ...defaultHandlers(), validate };
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '1.234' } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(lastOutcome?.result).toBe('refused'));
    expect(panel.handlers.save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Too many decimals');
    expect(screen.getByTestId('status').textContent).toBe('invalid');
    expect(count()).toBe('1');
  });

  it('maps a 422 to field issues and keeps the draft staged', async () => {
    const save = vi.fn(async () => {
      throw new ApiError(422, {
        error: { code: 'VALIDATION_FAILED', message: 'Invalid', details: [{ path: 'amount', issue: 'Must be positive' }] },
      });
    });
    panel.handlers = { ...defaultHandlers(), save };
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(lastOutcome?.result).toBe('failed'));
    expect(screen.getByRole('alert').textContent).toBe('Must be positive');
    expect(screen.getByTestId('status').textContent).toBe('failed');
    expect(count()).toBe('1');
  });

  it('names a 503 MODULE_DISABLED as the part being switched off (FR-034)', async () => {
    const save = vi.fn(async () => {
      throw new ApiError(503, { error: { code: 'MODULE_DISABLED', message: 'Module is disabled' } });
    });
    panel.handlers = { ...defaultHandlers(), save };
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(lastOutcome?.result).toBe('failed'));
    expect(lastOutcome?.parts[0]?.message).toBe('switched off');
    expect(screen.getByTestId('part-error').textContent).toBe('switched off');
  });

  it('writes the host part first, then the participants (FR-013)', async () => {
    const calls: string[] = [];
    panel.handlers = {
      ...defaultHandlers(),
      save: vi.fn(async (draft: PricesDraft) => {
        calls.push('participant');
        return draft;
      }),
    };
    hostPart = {
      id: 'host',
      label: 'Product fields',
      blocking: true,
      count: 1,
      validate: async () => ({ fields: {} }),
      save: async () => {
        calls.push('host');
      },
    };
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(lastOutcome?.result).toBe('saved'));
    expect(calls).toEqual(['host', 'participant']);
    expect(lastOutcome?.parts.map((part) => [part.id, part.label, part.count])).toEqual([
      ['host', 'Product fields', 1],
      ['test_prices:prices', 'Prices', 1],
    ]);
  });

  it('writes no participant when the host part fails (FR-015)', async () => {
    hostPart = {
      id: 'host',
      label: 'Product fields',
      blocking: true,
      validate: async () => ({ fields: {} }),
      save: async () => {
        throw new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'Changed elsewhere' } });
      },
    };
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(lastOutcome?.result).toBe('failed'));
    expect(panel.handlers.save).not.toHaveBeenCalled();
    expect(lastOutcome?.parts.map((part) => part.result)).toEqual(['failed', 'not-attempted']);
    expect(screen.getByTestId('status').textContent).toBe('dirty');
    expect(count()).toBe('1');
  });

  it('after a partial save only the failed part stays staged (OQ-1 = A)', async () => {
    hostPart = {
      id: 'host',
      label: 'Product fields',
      blocking: true,
      validate: async () => ({ fields: {} }),
      save: async () => undefined,
    };
    panel.handlers = {
      ...defaultHandlers(),
      save: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(lastOutcome?.result).toBe('partial'));
    expect(count()).toBe('1');
    expect(screen.getByTestId('part-error').textContent).toBe('boom');
  });

  it('an edit clears the last outcome (FR-016)', async () => {
    renderHost();
    fireEvent.change(await amountInput(), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(screen.getByTestId('outcome').textContent).toBe('saved'));

    fireEvent.change(await amountInput(), { target: { value: '13' } });
    expect(screen.getByTestId('outcome').textContent).toBe('');
  });
});

describe('a contribution under a host without a session', () => {
  it('keeps a local draft and takes part in nothing', async () => {
    const loaded: PricesDraft = { amount: '1' };
    const handlers = defaultHandlers();
    function Bare(): ReactElement {
      const participant = useSaveParticipant(
        INERT_SAVE_SESSION,
        { key: 'prices', label: 'Prices', writable: true, loaded },
        handlers,
      );
      return (
        <input
          aria-label="Bare"
          value={participant.draft?.amount ?? ''}
          onChange={(event) => participant.setDraft({ amount: event.target.value })}
        />
      );
    }
    render(wrap(<Bare />));
    const input = (await screen.findByLabelText('Bare')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } });
    expect(input.value).toBe('2');
    await act(async () => undefined);
  });
});

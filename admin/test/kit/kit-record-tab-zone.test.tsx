import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AdminZoneContribution } from '@endora-commerce/contracts';
import {
  recordTabComponent,
  zoneComponent,
  type AdminContributions,
  type RecordTabCounter,
} from '@endora-commerce/admin-kit/contributions';
import { useRecordTabZone, type RecordTabZoneItem } from '@endora-commerce/admin-kit/zones';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * `useRecordTabZone` and `recordTabComponent` — a record-tab zone, whose
 * contributions are whole tabs of a host's `RecordTabs`
 * (`specs/183-record-tab-contributions/contracts/record-tab-zone.md` RT2–RT4;
 * FR-004–FR-008).
 *
 * The host gets the tabs synchronously, before any chunk loads: presence,
 * permission and `match` are decided first, so neither the panel nor the count
 * of a tab the reader cannot see is ever imported. Each count is read once per
 * mount and per change of the zone props, aborted when it is superseded, and
 * shown as no count until it is a non-negative integer.
 */

const OPPORTUNITY = '00000000-0000-4000-8000-00000000a001';
const NEXT_OPPORTUNITY = '00000000-0000-4000-8000-00000000a002';

function Panel({ opportunityId }: { opportunityId: string }): ReactNode {
  return <p>{`panel for ${opportunityId}`}</p>;
}

function Broken(): ReactNode {
  throw new Error('panel exploded');
}

interface Probe {
  readonly panel: ReturnType<typeof vi.fn>;
  readonly countModule: ReturnType<typeof vi.fn>;
  readonly counter: ReturnType<typeof vi.fn>;
  readonly contribution: AdminZoneContribution;
}

/** A contributed tab whose two factories are spies, so "never imported" is observable. */
function probe(
  id: string,
  options: {
    weight?: number;
    requiredPermission?: string;
    answer?: (props: { opportunityId: string }, signal: AbortSignal) => Promise<number>;
    component?: (props: { opportunityId: string }) => ReactNode;
    withCount?: boolean;
  } = {},
): Probe {
  const counter = vi.fn(options.answer ?? ((): Promise<number> => Promise.resolve(3)));
  const panel = vi.fn(() => Promise.resolve({ default: options.component ?? Panel }));
  const countModule = vi.fn(() => Promise.resolve({ default: counter as unknown as RecordTabCounter<'opportunity.detail.tabs'> }));
  const contribution = recordTabComponent('opportunity.detail.tabs', panel, {
    tab: { id, labelKey: 'tab.label', countLabelKey: 'tab.countLabel' },
    ...(options.withCount === false ? {} : { count: countModule }),
    weight: options.weight ?? 0,
    ...(options.requiredPermission === undefined ? {} : { requiredPermission: options.requiredPermission }),
  });
  return { panel, countModule, counter, contribution };
}

function Host({
  opportunityId,
  active,
  reservedIds = ['overview', 'notes'],
}: {
  opportunityId: string;
  active: string;
  reservedIds?: readonly string[];
}): ReactNode {
  // An unmemoised literal, on purpose: the hook keys its reads on the values.
  const zone = useRecordTabZone('opportunity.detail.tabs', { opportunityId }, {
    reservedIds,
    fallback: <span>loading panel</span>,
  });
  return (
    <>
      <ul aria-label="strip">
        {zone.tabs.map((tab: RecordTabZoneItem) => (
          <li key={tab.id} data-module={tab.module} data-count={String(tab.count)}>
            {`${tab.id}|${tab.label}|${tab.countLabel ?? ''}`}
          </li>
        ))}
      </ul>
      <div data-testid="panel">{zone.renderPanel(active)}</div>
    </>
  );
}

const BUNDLE = {
  alpha: { 'tab.label': 'Alpha', 'tab.countLabel': '{label}, open: {count}' },
  beta: { 'tab.label': 'Beta', 'tab.countLabel': '{label}, due: {count}' },
  gamma: { 'tab.label': 'Gamma', 'tab.countLabel': '{label}, items: {count}' },
};

function render(
  entries: readonly { moduleId: string; contributions: AdminContributions }[],
  options: {
    opportunityId?: string;
    active?: string;
    present?: readonly string[];
    permissions?: readonly string[];
    reservedIds?: readonly string[];
  } = {},
): { rerender: (next: { opportunityId?: string; active?: string }) => void; unmount: () => void } {
  const tree = (opportunityId: string, active: string): ReactNode =>
    withSession(
      <Host
        opportunityId={opportunityId}
        active={active}
        {...(options.reservedIds === undefined ? {} : { reservedIds: options.reservedIds })}
      />,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['*'])] }),
        presence: modulePresence({ present: [...(options.present ?? ['alpha', 'beta', 'gamma'])] }),
        contributions: entries,
      },
    );
  let opportunityId = options.opportunityId ?? OPPORTUNITY;
  let active = options.active ?? 'none';
  const result = renderWithI18n(<>{tree(opportunityId, active)}</>, BUNDLE);
  return {
    rerender: (next): void => {
      opportunityId = next.opportunityId ?? opportunityId;
      active = next.active ?? active;
      result.rerender(<>{tree(opportunityId, active)}</>);
    },
    unmount: result.unmount,
  };
}

const strip = (): string[] =>
  within(screen.getByRole('list', { name: 'strip' }))
    .queryAllByRole('listitem')
    .map((item) => item.textContent ?? '');

const counts = (): (string | null)[] =>
  within(screen.getByRole('list', { name: 'strip' }))
    .queryAllByRole('listitem')
    .map((item) => item.getAttribute('data-count'));

/** Let every pending promise and the state updates behind them settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 5; round += 1) await Promise.resolve();
  });
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  warn.mockRestore();
});

describe('useRecordTabZone — the tabs', () => {
  it('lists the contributed tabs by weight and then module id, labelled from each contributor’s own bundle', async () => {
    const alpha = probe('alpha-tab', { weight: 200 });
    const gamma = probe('gamma-tab', { weight: 100 });
    const beta = probe('beta-tab', { weight: 100 });
    render([
      { moduleId: 'alpha', contributions: { zones: [alpha.contribution] } },
      { moduleId: 'gamma', contributions: { zones: [gamma.contribution] } },
      { moduleId: 'beta', contributions: { zones: [beta.contribution] } },
    ]);
    // Synchronous: the strip is there on the first render, before any count.
    expect(strip()).toEqual(['beta-tab|Beta|', 'gamma-tab|Gamma|', 'alpha-tab|Alpha|']);
    expect(counts()).toEqual(['null', 'null', 'null']);
    await waitFor(() => expect(counts()).toEqual(['3', '3', '3']));
    expect(strip()).toEqual([
      'beta-tab|Beta|Beta, due: 3',
      'gamma-tab|Gamma|Gamma, items: 3',
      'alpha-tab|Alpha|Alpha, open: 3',
    ]);
    // Neither panel chunk is fetched until a tab is opened.
    for (const entry of [alpha, beta, gamma]) expect(entry.panel).not.toHaveBeenCalled();
  });

  it('decides presence and permission before importing anything of a hidden tab', async () => {
    const shown = probe('shown');
    const absent = probe('absent');
    const refused = probe('refused', { requiredPermission: 'beta:read' });
    render(
      [
        { moduleId: 'alpha', contributions: { zones: [shown.contribution] } },
        { moduleId: 'gamma', contributions: { zones: [absent.contribution] } },
        { moduleId: 'beta', contributions: { zones: [refused.contribution] } },
      ],
      { present: ['alpha', 'beta'], permissions: ['alpha:read'], active: 'absent' },
    );
    expect(strip().map((line) => line.split('|')[0])).toEqual(['shown']);
    await waitFor(() => expect(counts()).toEqual(['3']));
    for (const hidden of [absent, refused]) {
      expect(hidden.countModule).not.toHaveBeenCalled();
      expect(hidden.counter).not.toHaveBeenCalled();
      expect(hidden.panel).not.toHaveBeenCalled();
    }
    // A hidden tab's id renders nothing, the same as an id nobody declares.
    expect(screen.getByTestId('panel')).toBeEmptyDOMElement();
  });

  it('keeps the count empty while it is pending, after a failure, and for an answer that is not a count', async () => {
    let release: (value: number) => void = () => {};
    const pending = probe('pending', { answer: () => new Promise<number>((resolve) => { release = resolve; }) });
    const failing = probe('failing', { answer: () => Promise.reject(new Error('offline')), weight: 1 });
    const fraction = probe('fraction', { answer: () => Promise.resolve(1.5), weight: 2 });
    const negative = probe('negative', { answer: () => Promise.resolve(-1), weight: 3 });
    const none = probe('none', { withCount: false, weight: 4 });
    render([
      {
        moduleId: 'alpha',
        contributions: {
          zones: [pending.contribution, failing.contribution, fraction.contribution, negative.contribution, none.contribution],
        },
      },
    ]);
    await settle();
    expect(counts()).toEqual(['null', 'null', 'null', 'null', 'null']);
    act(() => release(4));
    await waitFor(() => expect(counts()).toEqual(['4', 'null', 'null', 'null', 'null']));
    expect(none.countModule).not.toHaveBeenCalled();
  });

  it('reads each count once per mount, not once per render, with the zone props and a signal', async () => {
    const alpha = probe('alpha-tab');
    const view = render([{ moduleId: 'alpha', contributions: { zones: [alpha.contribution] } }]);
    await waitFor(() => expect(counts()).toEqual(['3']));
    view.rerender({ active: 'alpha-tab' });
    view.rerender({ active: 'none' });
    await settle();
    expect(alpha.counter).toHaveBeenCalledTimes(1);
    const [props, signal] = alpha.counter.mock.calls[0] as [unknown, AbortSignal];
    expect(props).toEqual({ opportunityId: OPPORTUNITY });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts a read that is superseded by another record, and re-reads for it', async () => {
    const signals: AbortSignal[] = [];
    const alpha = probe('alpha-tab', {
      answer: (props, signal) => {
        signals.push(signal);
        return props.opportunityId === OPPORTUNITY ? new Promise<number>(() => {}) : Promise.resolve(7);
      },
    });
    const view = render([{ moduleId: 'alpha', contributions: { zones: [alpha.contribution] } }]);
    await waitFor(() => expect(signals).toHaveLength(1));
    view.rerender({ opportunityId: NEXT_OPPORTUNITY });
    await waitFor(() => expect(counts()).toEqual(['7']));
    expect(signals[0]?.aborted).toBe(true);
    expect(alpha.counter).toHaveBeenLastCalledWith({ opportunityId: NEXT_OPPORTUNITY }, expect.any(AbortSignal));
    view.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it('does not show one record’s count on the next one while its own is being read', async () => {
    const alpha = probe('alpha-tab', {
      answer: (props) => (props.opportunityId === OPPORTUNITY ? Promise.resolve(5) : new Promise<number>(() => {})),
    });
    const view = render([{ moduleId: 'alpha', contributions: { zones: [alpha.contribution] } }]);
    await waitFor(() => expect(counts()).toEqual(['5']));
    view.rerender({ opportunityId: NEXT_OPPORTUNITY });
    expect(counts()).toEqual(['null']);
  });

  it('does not draw a tab whose id the host reserves, or one an earlier contribution took, and names both', async () => {
    const takesNotes = probe('notes', { weight: 0 });
    const first = probe('shared', { weight: 10 });
    const second = probe('shared', { weight: 20 });
    render([
      { moduleId: 'alpha', contributions: { zones: [takesNotes.contribution, first.contribution] } },
      { moduleId: 'beta', contributions: { zones: [second.contribution] } },
    ]);
    expect(strip().map((line) => line.split('|').slice(0, 2).join('|'))).toEqual(['shared|Alpha']);
    expect(screen.getByRole('listitem')).toHaveAttribute('data-module', 'alpha');
    await settle();
    expect(takesNotes.countModule).not.toHaveBeenCalled();
    expect(second.countModule).not.toHaveBeenCalled();
    const warnings = warn.mock.calls.map((call) => String(call[0]));
    expect(warnings.some((line) => line.includes("'alpha'") && line.includes("'notes'"))).toBe(true);
    expect(warnings.some((line) => line.includes("'beta'") && line.includes("'shared'") && line.includes("'alpha'"))).toBe(true);
  });

  it('does not draw a hand-written contribution that carries no tab data', () => {
    const raw: AdminZoneContribution = {
      zone: 'opportunity.detail.tabs',
      weight: 0,
      component: () => Promise.resolve({ default: Panel }),
    };
    render([{ moduleId: 'alpha', contributions: { zones: [raw] } }]);
    expect(strip()).toEqual([]);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("'alpha'"))).toBe(true);
  });
});

describe('useRecordTabZone — the panel', () => {
  it('renders the selected contributed tab with the zone props, and nothing for an id that is not a visible tab', async () => {
    const alpha = probe('alpha-tab');
    const view = render([{ moduleId: 'alpha', contributions: { zones: [alpha.contribution] } }], { active: 'alpha-tab' });
    expect(await screen.findByText(`panel for ${OPPORTUNITY}`)).toBeInTheDocument();
    view.rerender({ active: 'overview' });
    expect(screen.getByTestId('panel')).toBeEmptyDOMElement();
  });

  it('isolates a panel that throws: its body shows the zone error state, the strip keeps working', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = probe('broken', { component: Broken });
    const fine = probe('fine', { weight: 1 });
    const view = render(
      [{ moduleId: 'alpha', contributions: { zones: [broken.contribution, fine.contribution] } }],
      { active: 'broken' },
    );
    await waitFor(() =>
      expect(screen.getByTestId('panel').querySelector('[data-admin-zone-error="opportunity.detail.tabs"]')).not.toBeNull(),
    );
    expect(strip().map((line) => line.split('|')[0])).toEqual(['broken', 'fine']);
    view.rerender({ active: 'fine' });
    expect(await screen.findByText(`panel for ${OPPORTUNITY}`)).toBeInTheDocument();
    error.mockRestore();
  });
});

describe('recordTabComponent — the contributor’s declaration', () => {
  it('is the declaration written by hand, with both factories passed through', () => {
    const load = (): Promise<{ default: typeof Panel }> => Promise.resolve({ default: Panel });
    const count = (): Promise<{ default: RecordTabCounter<'opportunity.detail.tabs'> }> =>
      Promise.resolve({ default: () => Promise.resolve(1) });
    expect(
      recordTabComponent('opportunity.detail.tabs', load, {
        tab: { id: 'tasks', labelKey: 'recordTab.label' },
        count,
        weight: 100,
        requiredPermission: 'tasks:read',
      }),
    ).toEqual({
      zone: 'opportunity.detail.tabs',
      weight: 100,
      requiredPermission: 'tasks:read',
      tab: { id: 'tasks', labelKey: 'recordTab.label' },
      count,
      component: load,
    });
  });

  it('refuses a record-tab zone to zoneComponent, and a stack zone to recordTabComponent', () => {
    const load = (): Promise<{ default: typeof Panel }> => Promise.resolve({ default: Panel });
    // @ts-expect-error — a record-tab zone takes tab data; zoneComponent has none.
    zoneComponent('opportunity.detail.tabs', load);
    // @ts-expect-error — a stack zone takes no tab data.
    recordTabComponent('order.detail.after', () => Promise.resolve({ default: () => null }), {
      tab: { id: 'tasks', labelKey: 'recordTab.label' },
    });
    // @ts-expect-error — the count loader is checked against the zone's props.
    recordTabComponent('opportunity.detail.tabs', load, {
      tab: { id: 'tasks', labelKey: 'recordTab.label' },
      count: () => Promise.resolve({ default: (props: { orderId: string }) => Promise.resolve(props.orderId.length) }),
    });
    expectTypeOf<RecordTabCounter<'opportunity.detail.tabs'>>().parameters.toEqualTypeOf<
      [{ readonly opportunityId: string }, AbortSignal]
    >();
  });
});

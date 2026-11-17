import type { ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  FigureCard,
  prefersReducedMotion,
  useChartColors,
  useFigure,
  type Figure,
} from '@endora-commerce/admin-kit/components';
import { ApiError, RANGE_PRESETS, isDayRange, presetRange } from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';

/**
 * The analytics helpers promoted from CRM and Projects into the kit (issue
 * #464; constitution IX). Each module kept an identical copy of the read hook,
 * the chart colours and the range presets, and a near-identical figure frame;
 * the kit now holds the one copy, and these tests hold its behaviour.
 */

const CORE: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

function figureOf<T>(patch: Partial<Figure<T>>): Figure<T> {
  return { data: null, loading: false, error: null, reload: (): void => undefined, ...patch };
}

function renderCard(figure: Figure<number[]>, extra: { action?: ReactElement; footer?: (data: number[]) => ReactElement } = {}): void {
  render(
    <TranslationProvider language="en" initialBundle={{ core: CORE }}>
      <FigureCard
        title="Won deals"
        description="Over the chosen range."
        figure={figure}
        isEmpty={(data): boolean => data.length === 0}
        emptyMessage="Nothing in this range."
        errorFallback="This figure could not be loaded."
        {...extra}
      >
        {(data): ReactElement => <p>Total {data.length}</p>}
      </FigureCard>
    </TranslationProvider>,
  );
}

describe('FigureCard', () => {
  it('is a region named by its title, busy with a status line while loading', () => {
    renderCard(figureOf({ loading: true }));
    const region = screen.getByRole('region', { name: 'Won deals' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(CORE['common.state.loading'] ?? '');
    expect(screen.getByText('Over the chosen range.')).toBeInTheDocument();
  });

  it('keeps the status line mounted, empty, once the figure has arrived', () => {
    renderCard(figureOf({ data: [1, 2] }));
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByText('Total 2')).toBeInTheDocument();
  });

  it('says the empty message when the answer holds nothing', () => {
    renderCard(figureOf({ data: [] }));
    expect(screen.getByText('Nothing in this range.')).toBeInTheDocument();
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
  });

  it('says the server’s words on failure, with a retry that asks again', async () => {
    const reload = vi.fn();
    const error = new ApiError(422, { error: { code: 'invalid_range', message: 'The range is too long.' } } as never);
    renderCard(figureOf({ error, reload }));
    expect(screen.getByText('The range is too long.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: CORE['common.action.retry'] ?? '' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says the fallback when the failure carries no words of the server', () => {
    renderCard(figureOf({ error: new Error('network') }));
    expect(screen.getByText('This figure could not be loaded.')).toBeInTheDocument();
  });

  it('draws the action beside the title and the footer under the figure, the empty one included', () => {
    renderCard(figureOf({ data: [] }), {
      action: <button type="button">Switch</button>,
      footer: (data): ReactElement => <p>Counted {data.length}</p>,
    });
    expect(screen.getByRole('button', { name: 'Switch' })).toBeInTheDocument();
    expect(screen.getByText('Counted 0')).toBeInTheDocument();
  });

  it('draws no footer while loading or after a failure', () => {
    renderCard(figureOf({ error: new Error('x') }), { footer: (): ReactElement => <p>Counted</p> });
    expect(screen.queryByText('Counted')).not.toBeInTheDocument();
  });
});

describe('useFigure', () => {
  it('does not ask while load is null', () => {
    const { result } = renderHook(() => useFigure<number>(null));
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });
  });

  it('answers what load resolves and asks again by hand', async () => {
    let calls = 0;
    const load = (): Promise<number> => Promise.resolve(++calls);
    const { result } = renderHook(() => useFigure(load));
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(result.current.loading).toBe(false);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it('keeps the error a failed load throws', async () => {
    const failure = new Error('down');
    const load = (): Promise<number> => Promise.reject(failure);
    const { result } = renderHook(() => useFigure(load));
    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.loading).toBe(false);
  });

  it('is never answered by a slower, earlier request', async () => {
    let resolveSlow: (value: string) => void = () => undefined;
    const slow = (): Promise<string> => new Promise((r) => (resolveSlow = r));
    const fast = (): Promise<string> => Promise.resolve('fast');
    const { result, rerender } = renderHook(({ load }) => useFigure(load), { initialProps: { load: slow } });
    rerender({ load: fast });
    await waitFor(() => expect(result.current.data).toBe('fast'));
    await act(async () => resolveSlow('slow'));
    expect(result.current.data).toBe('fast');
  });
});

describe('useChartColors', () => {
  it('reads the theme tokens off the root as canvas colours, and again when the theme class changes', async () => {
    const root = document.documentElement;
    root.style.setProperty('--foreground', '220 7% 11%');
    root.style.setProperty('--muted-foreground', '220 9% 40%');
    root.style.setProperty('--border', '220 6% 90%');
    root.style.setProperty('--primary', '243 75% 59%');
    try {
      const { result } = renderHook(() => useChartColors());
      expect(result.current).toEqual({
        text: 'hsl(220, 7%, 11%)',
        muted: 'hsl(220, 9%, 40%)',
        line: 'hsl(220, 6%, 90%)',
        bar: 'hsl(243, 75%, 59%)',
      });
      root.style.setProperty('--primary', '0 0% 0%');
      root.classList.add('dark');
      await waitFor(() => expect(result.current.bar).toBe('hsl(0, 0%, 0%)'));
    } finally {
      root.classList.remove('dark');
      for (const name of ['--foreground', '--muted-foreground', '--border', '--primary']) root.style.removeProperty(name);
    }
  });

  it('falls back to fixed colours when a token is not a triplet', () => {
    const { result } = renderHook(() => useChartColors());
    expect(result.current).toEqual({ text: '#1a1c1f', muted: '#5c6370', line: '#e4e5e7', bar: '#4f46e5' });
  });

  it('reads the reduced-motion preference', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    try {
      expect(prefersReducedMotion()).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });
});

/**
 * The range presets in the reporting time zone (issue #475): "today" is the
 * day it is in the zone the server counts in, not on the operator's computer,
 * so a preset and the server's counting agree around midnight.
 */
describe('presetRange in the reporting time zone', () => {
  // 23:30 UTC on 31 March is 01:30 on 1 April in Warsaw (UTC+2 in summer).
  const now = new Date('2026-03-31T23:30:00.000Z');

  it('lists the presets the range picker offers, custom last', () => {
    expect(RANGE_PRESETS).toEqual(['thisMonth', 'lastMonth', 'last90Days', 'thisYear', 'custom']);
  });

  it('takes today from the zone, across a month boundary', () => {
    expect(presetRange('thisMonth', { timeZone: 'Europe/Warsaw', now })).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    expect(presetRange('lastMonth', { timeZone: 'Europe/Warsaw', now })).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(presetRange('last90Days', { timeZone: 'Europe/Warsaw', now })).toEqual({ from: '2026-01-02', to: '2026-04-01' });
    expect(presetRange('thisYear', { timeZone: 'Europe/Warsaw', now })).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('answers the same instant differently in UTC', () => {
    expect(presetRange('thisMonth', { timeZone: 'UTC', now })).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(presetRange('last90Days', { timeZone: 'UTC', now })).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });

  it('west of Greenwich, across a year boundary', () => {
    // 03:00 UTC on 1 January is still 31 December in New York (UTC−5).
    const newYear = new Date('2026-01-01T03:00:00.000Z');
    expect(presetRange('thisMonth', { timeZone: 'America/New_York', now: newYear })).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('thisYear', { timeZone: 'America/New_York', now: newYear })).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('takes the computer’s own calendar while the zone is not yet known, or is unknown to the browser', () => {
    const local = new Date(2026, 5, 15, 12);
    expect(presetRange('thisMonth', { now: local })).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(presetRange('thisMonth', { timeZone: null, now: local })).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(presetRange('thisMonth', { timeZone: 'Not/AZone', now: local })).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });
});

describe('isDayRange', () => {
  it('holds two calendar days, the first not after the second', () => {
    expect(isDayRange({ from: '2026-01-01', to: '2026-01-01' })).toBe(true);
    expect(isDayRange({ from: '2026-01-02', to: '2026-01-01' })).toBe(false);
    expect(isDayRange({ from: '2026-1-1', to: '2026-01-02' })).toBe(false);
    expect(isDayRange({ from: '', to: '2026-01-02' })).toBe(false);
  });
});

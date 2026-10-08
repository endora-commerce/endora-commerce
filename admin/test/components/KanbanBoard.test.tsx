import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import {
  KanbanBoard,
  type KanbanBoardLabels,
  type KanbanBoardProps,
} from '@endora-commerce/admin-kit/components';

/**
 * The reusable board primitive of `@endora-commerce/admin-kit` (feature 143, T148).
 *
 * These tests are also the measurement behind research note N-K1: `@dnd-kit/core`
 * 6.x declares `react >=16.8.0` and nothing in the registry says whether it runs
 * under React 19. Every drag below goes through the library's real sensors,
 * collision detection and live region — nothing of `@dnd-kit/core` is mocked.
 *
 * What **is** substituted is geometry. jsdom lays nothing out, so every
 * `getBoundingClientRect` answers a zero rectangle and no pointer could ever be
 * "within" a lane. The lanes are therefore given a rectangle each, 300 px apart,
 * derived from their position in the DOM — the one thing a browser would have
 * supplied and jsdom cannot.
 */

interface Lane {
  id: string;
  title: string;
}

interface Ticket {
  id: string;
  title: string;
}

const LANES: Lane[] = [
  { id: 'todo', title: 'To do' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
];

const TICKETS: Record<string, Ticket[]> = {
  todo: [
    { id: 't1', title: 'First' },
    { id: 't2', title: 'Second' },
  ],
  doing: [{ id: 't3', title: 'Third' }],
  done: [],
};

const labels: KanbanBoardLabels<Ticket, Lane> = {
  board: 'Test board',
  column: (lane) => `Lane ${lane.title}`,
  dragHandle: (ticket) => `Move ${ticket.title}`,
  dragHandleRoleDescription: 'movable card',
  instructions: 'Press Space to lift, the arrow keys to choose a lane, Space to drop.',
  pickedUp: (ticket, from) => `Picked up ${ticket.title} in ${from.title}`,
  over: (ticket, lane, allowed) =>
    allowed ? `${ticket.title} is over ${lane.title}` : `${ticket.title} cannot go to ${lane.title}`,
  dropped: (ticket, from, to) => `Moved ${ticket.title} from ${from.title} to ${to.title}`,
  refused: (ticket, _from, to) => `${ticket.title} was not moved to ${to.title}`,
  cancelled: (ticket, from) => `${ticket.title} stays in ${from.title}`,
  moveFailed: (ticket, from, _to, error) =>
    `${ticket.title} is back in ${from.title}: ${error instanceof Error ? error.message : 'unknown'}`,
};

function Board(overrides: Partial<KanbanBoardProps<Ticket, Lane>>): ReactElement {
  return (
    <KanbanBoard<Ticket, Lane>
      columns={LANES}
      getColumnId={(lane) => lane.id}
      itemsByColumn={TICKETS}
      getItemId={(ticket) => ticket.id}
      onMove={() => undefined}
      renderColumnHeader={(lane, state) => (
        <h3>
          {lane.title} ({state.itemCount})
        </h3>
      )}
      renderCard={(ticket) => (
        <div>
          <a href={`/tickets/${ticket.id}`}>{ticket.title}</a>
          <button type="button">Menu for {ticket.title}</button>
        </div>
      )}
      labels={labels}
      {...overrides}
    />
  );
}

const LANE_WIDTH = 280;
const LANE_PITCH = 300;

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function laneIndexOf(lane: Element): number {
  return Array.from(document.querySelectorAll('[data-kanban-column]')).indexOf(lane);
}

function laneCentre(laneId: string): { clientX: number; clientY: number } {
  return { clientX: LANES.findIndex((l) => l.id === laneId) * LANE_PITCH + LANE_WIDTH / 2, clientY: 300 };
}

/** Lets the library's effects, its `setTimeout(…, 0)` listeners and React settle. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function lane(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-kanban-column="${id}"]`);
  if (node === null) throw new Error(`no lane ${id}`);
  return node;
}

function card(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-kanban-card="${id}"]`);
  if (node === null) throw new Error(`no card ${id}`);
  return node;
}

function laneOfCard(id: string): string | undefined {
  return card(id).closest<HTMLElement>('[data-kanban-column]')?.dataset.kanbanColumn;
}

/** Everything any live region on the page currently says. */
function announced(): string {
  return screen
    .getAllByRole('status')
    .map((node) => node.textContent ?? '')
    .join(' | ');
}

async function pointerDrag(cardId: string, toLaneId: string | null): Promise<void> {
  const source = card(cardId);
  const start = laneCentre(laneOfCard(cardId) ?? '');
  fireEvent.mouseDown(source, { button: 0, ...start });
  await settle();
  // Past the activation distance, still over the source lane.
  fireEvent.mouseMove(document, { clientX: start.clientX + 20, clientY: start.clientY });
  await settle();
  const target = toLaneId === null ? { clientX: 5000, clientY: 5000 } : laneCentre(toLaneId);
  fireEvent.mouseMove(document, target);
  await settle();
  fireEvent.mouseUp(document, target);
  await settle();
}

async function keyboard(code: 'Space' | 'ArrowRight' | 'ArrowLeft' | 'Escape'): Promise<void> {
  const target = document.activeElement ?? document.body;
  fireEvent.keyDown(target, { code, key: code === 'Space' ? ' ' : code });
  await settle();
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    if (this.hasAttribute('data-kanban-column')) {
      return rectOf(laneIndexOf(this) * LANE_PITCH, 0, LANE_WIDTH, 600);
    }
    const owner = this.closest('[data-kanban-column]');
    if (owner !== null && this.hasAttribute('data-kanban-card')) {
      return rectOf(laneIndexOf(owner) * LANE_PITCH + 10, 50, LANE_WIDTH - 20, 80);
    }
    return rectOf(0, 0, 0, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KanbanBoard — rendering', () => {
  it('renders one lane per column with its header and one card per item', () => {
    render(<Board />);

    expect(screen.getByRole('region', { name: 'Test board' })).toBeInTheDocument();
    const lanes = Array.from(document.querySelectorAll<HTMLElement>('[data-kanban-column]'));
    expect(lanes.map((node) => node.dataset.kanbanColumn)).toEqual(['todo', 'doing', 'done']);

    expect(within(lane('todo')).getByRole('heading', { name: 'To do (2)' })).toBeInTheDocument();
    expect(within(lane('doing')).getByRole('heading', { name: 'Doing (1)' })).toBeInTheDocument();
    expect(within(lane('done')).getByRole('heading', { name: 'Done (0)' })).toBeInTheDocument();

    expect(within(lane('todo')).getAllByRole('listitem')).toHaveLength(2);
    expect(within(lane('todo')).getByRole('link', { name: 'First' })).toBeInTheDocument();
    expect(within(lane('doing')).getByRole('link', { name: 'Third' })).toBeInTheDocument();
    expect(within(lane('done')).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('names each lane and each drag handle with the caller’s labels', () => {
    render(<Board />);

    expect(screen.getByRole('group', { name: 'Lane Doing' })).toBe(lane('doing'));
    const handle = screen.getByRole('button', { name: 'Move First' });
    expect(handle).toHaveAttribute('aria-roledescription', 'movable card');
    expect(handle).toHaveAccessibleDescription(labels.instructions);
  });

  it('renders the loading, error and empty slots per column', () => {
    const states: Record<string, 'ready' | 'loading' | 'error'> = {
      todo: 'loading',
      doing: 'error',
      done: 'ready',
    };
    render(
      <Board
        getColumnState={(l) => states[l.id] ?? 'ready'}
        renderColumnLoading={(l) => <p>Loading {l.title}</p>}
        renderColumnError={(l) => <p>Could not load {l.title}</p>}
        renderColumnEmpty={(l) => <p>Nothing in {l.title}</p>}
      />,
    );

    expect(within(lane('todo')).getByText('Loading To do')).toBeInTheDocument();
    expect(lane('todo')).toHaveAttribute('aria-busy', 'true');
    expect(within(lane('doing')).getByText('Could not load Doing')).toBeInTheDocument();
    expect(within(lane('done')).getByText('Nothing in Done')).toBeInTheDocument();
    // A lane that has items is neither empty nor replaced by a slot.
    expect(within(lane('todo')).queryByText('Nothing in To do')).not.toBeInTheDocument();
  });

  it('renders an optional footer under each lane', () => {
    render(<Board renderColumnFooter={(l) => <button type="button">More in {l.title}</button>} />);
    expect(within(lane('doing')).getByRole('button', { name: 'More in Doing' })).toBeInTheDocument();
  });
});

describe('KanbanBoard — pointer drag', () => {
  it('reports a drop on an accepting lane exactly once', async () => {
    const onMove = vi.fn();
    render(<Board onMove={onMove} />);

    await pointerDrag('t1', 'doing');

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('t1', 'todo', 'doing');
  });

  it('marks every lane as accepting or refusing while a card is lifted', async () => {
    render(<Board canDrop={(_ticket, to) => to !== 'done'} />);

    expect(lane('doing')).not.toHaveAttribute('data-drop-state');

    const start = laneCentre('todo');
    fireEvent.mouseDown(card('t1'), { button: 0, ...start });
    await settle();
    fireEvent.mouseMove(document, { clientX: start.clientX + 20, clientY: start.clientY });
    await settle();

    expect(lane('todo')).toHaveAttribute('data-drop-state', 'source');
    expect(lane('doing')).toHaveAttribute('data-drop-state', 'allowed');
    expect(lane('done')).toHaveAttribute('data-drop-state', 'refused');
    expect(lane('done')).toHaveAttribute('aria-disabled', 'true');

    fireEvent.mouseMove(document, laneCentre('done'));
    await settle();
    expect(lane('done')).toHaveAttribute('data-drop-over', 'true');
    expect(announced()).toContain('First cannot go to Done');

    fireEvent.mouseUp(document, laneCentre('done'));
    await settle();
    expect(lane('done')).not.toHaveAttribute('data-drop-state');
  });

  it('calls nothing and leaves the card where it was on a refusing lane', async () => {
    const onMove = vi.fn();
    render(<Board onMove={onMove} canDrop={(_ticket, to) => to !== 'done'} />);

    await pointerDrag('t1', 'done');

    expect(onMove).not.toHaveBeenCalled();
    expect(laneOfCard('t1')).toBe('todo');
    expect(announced()).toContain('First was not moved to Done');
  });

  it('calls nothing when the card is dropped on its own lane', async () => {
    const onMove = vi.fn();
    render(<Board onMove={onMove} />);

    await pointerDrag('t1', 'todo');

    expect(onMove).not.toHaveBeenCalled();
    expect(laneOfCard('t1')).toBe('todo');
  });

  it('calls nothing when the card is dropped outside every lane', async () => {
    const onMove = vi.fn();
    render(<Board onMove={onMove} />);

    await pointerDrag('t1', null);

    expect(onMove).not.toHaveBeenCalled();
    expect(announced()).toContain('First stays in To do');
  });

  it('does not start a drag from a link or a button inside the card', async () => {
    const onMove = vi.fn();
    render(<Board onMove={onMove} />);

    for (const control of [
      screen.getByRole('link', { name: 'First' }),
      screen.getByRole('button', { name: 'Menu for First' }),
    ]) {
      const start = laneCentre('todo');
      fireEvent.mouseDown(control, { button: 0, ...start });
      await settle();
      fireEvent.mouseMove(document, { clientX: start.clientX + 20, clientY: start.clientY });
      await settle();
      expect(lane('doing')).not.toHaveAttribute('data-drop-state');
      fireEvent.mouseMove(document, laneCentre('doing'));
      await settle();
      fireEvent.mouseUp(document, laneCentre('doing'));
      await settle();
    }

    expect(onMove).not.toHaveBeenCalled();
  });

  it('honours a caller-marked no-drag region inside the card', async () => {
    const onMove = vi.fn();
    render(
      <Board
        onMove={onMove}
        renderCard={(ticket) => <div data-kanban-no-drag="">Notes of {ticket.title}</div>}
      />,
    );

    const start = laneCentre('todo');
    fireEvent.mouseDown(screen.getByText('Notes of First'), { button: 0, ...start });
    await settle();
    fireEvent.mouseMove(document, laneCentre('doing'));
    await settle();
    fireEvent.mouseUp(document, laneCentre('doing'));
    await settle();

    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('KanbanBoard — touch drag', () => {
  it('lifts after a press-and-hold and reports the drop', async () => {
    const onMove = vi.fn();
    render(<Board onMove={onMove} />);

    const start = laneCentre('todo');
    // A touch sequence is delivered to the element it started on, wherever the
    // finger goes — so that is where the move and the end are fired.
    const surface = card('t1');
    fireEvent.touchStart(surface, { touches: [start] });
    // The hold that tells a drag from a scroll.
    await settle(350);
    expect(lane('doing')).toHaveAttribute('data-drop-state', 'allowed');

    fireEvent.touchMove(surface, { touches: [laneCentre('doing')] });
    await settle();
    fireEvent.touchEnd(surface, { changedTouches: [laneCentre('doing')] });
    await settle();

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('t1', 'todo', 'doing');
  });
});

describe('KanbanBoard — keyboard drag', () => {
  it('lifts with Space, moves between lanes with the arrows and drops with Space, announcing each step', async () => {
    const onMove = vi.fn();
    render(<Board onMove={onMove} canDrop={(_ticket, to) => to !== 'done'} />);

    const handle = screen.getByRole('button', { name: 'Move First' });
    handle.focus();
    expect(handle).toHaveFocus();

    await keyboard('Space');
    expect(announced()).toContain('Picked up First in To do');
    expect(lane('doing')).toHaveAttribute('data-drop-state', 'allowed');

    await keyboard('ArrowRight');
    expect(announced()).toContain('First is over Doing');

    await keyboard('ArrowRight');
    expect(announced()).toContain('First cannot go to Done');

    await keyboard('ArrowLeft');
    expect(announced()).toContain('First is over Doing');

    await keyboard('Space');
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('t1', 'todo', 'doing');
    expect(announced()).toContain('Moved First from To do to Doing');
  });

  it('cancels with Escape, calling nothing', async () => {
    const onMove = vi.fn();
    render(<Board onMove={onMove} />);

    screen.getByRole('button', { name: 'Move First' }).focus();
    await keyboard('Space');
    await keyboard('ArrowRight');
    await keyboard('Escape');

    expect(onMove).not.toHaveBeenCalled();
    expect(laneOfCard('t1')).toBe('todo');
    expect(announced()).toContain('First stays in To do');
    expect(lane('doing')).not.toHaveAttribute('data-drop-state');
  });

  it('does not lift from a control inside the card', async () => {
    render(<Board />);

    screen.getByRole('button', { name: 'Menu for First' }).focus();
    await keyboard('Space');

    expect(lane('doing')).not.toHaveAttribute('data-drop-state');
  });
});

describe('KanbanBoard — optimistic move', () => {
  function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('shows the card in its new lane while the caller’s promise is pending, and rolls it back on rejection', async () => {
    const work = deferred();
    render(<Board onMove={() => work.promise} />);

    await pointerDrag('t1', 'doing');

    expect(laneOfCard('t1')).toBe('doing');
    expect(card('t1')).toHaveAttribute('aria-busy', 'true');
    expect(within(lane('todo')).getByRole('heading', { name: 'To do (1)' })).toBeInTheDocument();
    expect(within(lane('doing')).getByRole('heading', { name: 'Doing (2)' })).toBeInTheDocument();

    await act(async () => {
      work.reject(new Error('not allowed by the server'));
      await work.promise.catch(() => undefined);
    });
    await settle();

    expect(laneOfCard('t1')).toBe('todo');
    expect(card('t1')).not.toHaveAttribute('aria-busy');
    expect(announced()).toContain('First is back in To do: not allowed by the server');
  });

  it('hands the card back to the caller’s data once the promise resolves', async () => {
    const work = deferred();
    function Host(): ReactNode {
      return <Board onMove={() => work.promise} />;
    }
    const view = render(<Host />);

    await pointerDrag('t1', 'doing');
    expect(laneOfCard('t1')).toBe('doing');

    // The caller refreshes its data, then its promise settles.
    const moved: Record<string, Ticket[]> = {
      todo: [{ id: 't2', title: 'Second' }],
      doing: [
        { id: 't3', title: 'Third' },
        { id: 't1', title: 'First' },
      ],
      done: [],
    };
    view.rerender(<Board onMove={() => work.promise} itemsByColumn={moved} />);
    await act(async () => {
      work.resolve();
      await work.promise;
    });
    await settle();

    expect(laneOfCard('t1')).toBe('doing');
    expect(card('t1')).not.toHaveAttribute('aria-busy');
    expect(document.querySelectorAll('[data-kanban-card="t1"]')).toHaveLength(1);
  });

  it('does not let a card be lifted again while its move is pending', async () => {
    const work = deferred();
    const onMove = vi.fn(() => work.promise);
    render(<Board onMove={onMove} />);

    await pointerDrag('t1', 'doing');
    await pointerDrag('t1', 'done');

    expect(onMove).toHaveBeenCalledTimes(1);
    // `aria-disabled`, not `disabled`: the handle has to stay focusable, because
    // a keyboard drop hands the focus back to it.
    const handle = screen.getByRole('button', { name: 'Move First' });
    expect(handle).toHaveAttribute('aria-disabled', 'true');
    expect(handle).not.toBeDisabled();
  });

  it('returns the focus to the moved card’s handle after a keyboard drop', async () => {
    const work = deferred();
    render(<Board onMove={() => work.promise} />);

    screen.getByRole('button', { name: 'Move First' }).focus();
    await keyboard('Space');
    await keyboard('ArrowRight');
    await keyboard('Space');
    // The library restores the focus on the next animation frame.
    await settle(50);

    expect(laneOfCard('t1')).toBe('doing');
    expect(screen.getByRole('button', { name: 'Move First' })).toHaveFocus();
  });
});

describe('KanbanBoard — read-only', () => {
  it('renders no handle and lifts nothing when disabled', async () => {
    const onMove = vi.fn();
    render(<Board onMove={onMove} disabled />);

    expect(screen.queryByRole('button', { name: 'Move First' })).not.toBeInTheDocument();
    await pointerDrag('t1', 'doing');

    expect(onMove).not.toHaveBeenCalled();
    // The card's own controls are untouched.
    expect(screen.getByRole('button', { name: 'Menu for First' })).toBeInTheDocument();
  });
});

describe('KanbanBoard — size and scrolling', () => {
  // jsdom lays nothing out, so these hold the classes that carry the layout;
  // what they do in a browser is measured there (research N-P3).
  const classes = (element: Element): string[] => element.className.split(/\s+/);

  it('gives the drag handle a 44 px hit area around its 28 px picture', () => {
    render(<Board />);
    const handle = classes(screen.getByRole('button', { name: 'Move First' }));
    expect(handle).toEqual(expect.arrayContaining(['relative', 'h-7', 'w-7']));
    // 28 px + 8 px on every side, drawn by a pseudo-element so the card is no taller.
    expect(handle).toEqual(expect.arrayContaining(['after:absolute', 'after:-inset-2']));
    // The card keeps that area clear of its own content.
    const card = classes(screen.getByRole('button', { name: 'Move First' }).closest('li') as Element);
    expect(card).toContain('gap-2');
  });

  it('lets a lane scroll its own cards, under a header that stays put', () => {
    render(<Board />);
    const lane = screen.getByRole('group', { name: 'Lane To do' });
    expect(classes(lane)).toContain('flex-col');
    const list = classes(within(lane).getByRole('list'));
    expect(list).toEqual(expect.arrayContaining(['min-h-16', 'flex-1', 'overflow-y-auto']));
    // The header is the lane's child and not the list's, so it does not scroll away.
    expect(within(lane).getByRole('list')).not.toContainElement(within(lane).getByRole('heading'));
  });

  it('bounds nothing itself: the height is the caller’s, through className', () => {
    render(<Board className="max-h-96" />);
    const board = screen.getByRole('region', { name: 'Test board' });
    expect(classes(board)).toContain('max-h-96');
    expect(classes(board).some((name) => name.startsWith('h-'))).toBe(false);
  });

  it('lets lanes share the width they are given and keeps a readable minimum', () => {
    render(<Board />);
    const lane = classes(screen.getByRole('group', { name: 'Lane To do' }));
    expect(lane).toEqual(expect.arrayContaining(['min-w-64', 'flex-1', 'basis-64']));
    expect(lane).not.toContain('w-72');
  });
});

describe('KanbanBoard — domain-free', () => {
  it('carries no vocabulary of its first consumer', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../../packages/admin-kit/src/components/kanban/KanbanBoard.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/opportunit|status|crm/i);
  });

  it('imports the drag library from its core package only', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../../packages/admin-kit/src/components/kanban/KanbanBoard.tsx'),
      'utf8',
    );
    const specifiers = Array.from(source.matchAll(/from '(@dnd-kit\/[^']+)'/g), (m) => m[1]);
    expect(new Set(specifiers)).toEqual(new Set(['@dnd-kit/core']));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import {
  FieldProtectionPricePanel,
  FieldProtectionSummary,
  FieldProtectionToggle,
  type FieldProtectionEntry,
  type FieldProtectionSource,
  type FieldProtectionView,
} from '@endora-commerce/admin-kit/field-protection';

/**
 * Feature 091, P4b — `@endora-commerce/admin-kit/field-protection` is the kit's.
 *
 * **What this file asserts is the R6 line, not a screen.** The three things the
 * kit took are the per-scope store, the mount de-duplication and the optimistic
 * write with its rollback; `load` and `save` arrive by prop from the caller that
 * owns them (`admin-kit-surface.md` R6 as extended 2026-08-31). So every case
 * here drives the real components over a `load`/`save` pair this file supplies,
 * and asserts the generic behaviour: one read per scope however many controls
 * mount, two scopes never sharing one, and a refused write putting the checkbox
 * back.
 *
 * **The two-integration case is the one the duplication would have made
 * impossible to get right.** `pim_ergonode` and `pim_pimcore` mounted on one
 * product are two sources, two stores, two reads and two visibly-distinct
 * controls — which is why `sourceLabel` and `scopeKey` are on the descriptor at
 * all, and why a shared store keyed on the record id would be wrong rather than
 * merely wasteful.
 */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111101';
const LIST_ID = '22222222-2222-4222-8222-222222222202';

function view(over: Partial<FieldProtectionView> = {}): FieldProtectionView {
  return {
    connectionEnabled: true,
    integrationManaged: true,
    lastSyncedAt: null,
    sourceKind: null,
    variantCount: 0,
    livePricePaths: [],
    protections: [],
    ...over,
  };
}

/** A translator that renders the key, so an assertion names the key. */
function passthrough(key: string, params?: Record<string, string | number>): string {
  const values = params ? Object.values(params).map(String).join('|') : '';
  return values === '' ? key : `${key}[${values}]`;
}

interface Harness {
  readonly source: FieldProtectionSource;
  readonly load: ReturnType<typeof vi.fn>;
  readonly save: ReturnType<typeof vi.fn>;
}

function harness(options: {
  readonly label: string;
  readonly scopeKey?: string;
  readonly initial?: FieldProtectionView;
  readonly failLoad?: boolean;
}): Harness {
  const load = vi.fn(async (): Promise<FieldProtectionView> => {
    if (options.failLoad) throw new Error('unavailable');
    return options.initial ?? view();
  });
  const save = vi.fn(
    async (protections: readonly FieldProtectionEntry[]): Promise<FieldProtectionView> =>
      view({ ...(options.initial ?? view()), protections }),
  );
  return {
    load,
    save,
    source: {
      scopeKey: options.scopeKey ?? `${options.label}:${PRODUCT_ID}`,
      sourceLabel: options.label,
      t: passthrough,
      load: () => load(),
      save: (protections) => save(protections),
    },
  };
}

function renderTree(ui: ReactElement): ReturnType<typeof render> {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <>{children}</>;
  return render(ui, { wrapper });
}

function checkboxes(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
}

describe('admin-kit field protection — the store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads once however many controls mount on one scope', async () => {
    // The de-duplication, which is the reason the state is a module-scoped
    // store and not a hook-local fetch: a dozen controls render on one product,
    // in four tabs of a screen the integration does not own.
    const h = harness({ label: 'Ergonode', scopeKey: `dedup:${PRODUCT_ID}` });
    const { container } = renderTree(
      <>
        <FieldProtectionToggle source={h.source} fieldPath="name" />
        <FieldProtectionToggle source={h.source} fieldPath="description" />
        <FieldProtectionToggle source={h.source} fieldPath="categories" />
      </>,
    );

    await waitFor(() => expect(checkboxes(container)).toHaveLength(3));
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('keeps two integrations on one record apart, in state and in the DOM', async () => {
    // The case the 90%-identical copies could not have got right, and the whole
    // product reason P4b exists. Two sources, two reads, two labelled controls
    // — and distinct DOM ids, or one `htmlFor` points at the other's checkbox.
    const ergonode = harness({
      label: 'Ergonode',
      scopeKey: `pim_ergonode:${PRODUCT_ID}`,
      initial: view({ protections: [{ fieldPath: 'name', languageCode: null }] }),
    });
    const pimcore = harness({ label: 'Pimcore', scopeKey: `pim_pimcore:${PRODUCT_ID}` });

    const { container } = renderTree(
      <>
        <FieldProtectionToggle source={ergonode.source} fieldPath="name" />
        <FieldProtectionToggle source={pimcore.source} fieldPath="name" />
      </>,
    );

    await waitFor(() => expect(checkboxes(container)).toHaveLength(2));
    expect(ergonode.load).toHaveBeenCalledTimes(1);
    expect(pimcore.load).toHaveBeenCalledTimes(1);
    // Ergonode's `name` is protected and Pimcore's is not: one store per scope.
    expect(checkboxes(container).map((el) => el.checked)).toEqual([true, false]);
    expect(new Set(checkboxes(container).map((el) => el.id)).size).toBe(2);
    expect(container.textContent).toContain('Ergonode');
    expect(container.textContent).toContain('Pimcore');
  });

  it('moves the checkbox immediately and puts it back when the save is refused', async () => {
    // Both halves of the optimistic write in one case, because either alone is
    // a control that feels broken or a control that lies.
    const h = harness({ label: 'Ergonode', scopeKey: `rollback:${PRODUCT_ID}` });
    h.save.mockRejectedValue(new Error('refused'));
    const { container } = renderTree(
      <FieldProtectionToggle source={h.source} fieldPath="name" />,
    );
    await waitFor(() => expect(checkboxes(container)).toHaveLength(1));

    fireEvent.click(checkboxes(container)[0]!);
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0]![0]).toEqual([{ fieldPath: 'name', languageCode: null }]);
    await waitFor(() => expect(checkboxes(container)[0]!.checked).toBe(false));
    expect(container.textContent).toContain('fieldProtection.saveFailed');
  });

  it('sends the whole set, never a delta', async () => {
    // The owner's surface is a declarative replace, so the control computes the
    // state it wants the record to be in from the state it is rendering.
    const h = harness({
      label: 'Ergonode',
      scopeKey: `replace:${PRODUCT_ID}`,
      initial: view({
        protections: [
          { fieldPath: 'name', languageCode: null },
          { fieldPath: 'gallery', languageCode: null },
        ],
      }),
    });
    const { container } = renderTree(
      <FieldProtectionToggle source={h.source} fieldPath="gallery" />,
    );
    await waitFor(() => expect(checkboxes(container)).toHaveLength(1));

    fireEvent.click(checkboxes(container)[0]!);
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0]![0]).toEqual([{ fieldPath: 'name', languageCode: null }]);
  });

  it('renders nothing at all when the owner reports no enabled connection', async () => {
    const h = harness({
      label: 'Ergonode',
      scopeKey: `disabled:${PRODUCT_ID}`,
      initial: view({ connectionEnabled: false }),
    });
    const { container } = renderTree(
      <>
        <FieldProtectionToggle source={h.source} fieldPath="name" />
        <FieldProtectionSummary source={h.source} />
        <FieldProtectionPricePanel source={h.source} />
      </>,
    );
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the read is refused, and reports no error to the operator', async () => {
    // Not configured, not permitted, unreachable: three answers, one meaning
    // for an *addition* — there is nothing to offer here.
    const h = harness({ label: 'Ergonode', scopeKey: `refused:${PRODUCT_ID}`, failLoad: true });
    const { container } = renderTree(<FieldProtectionSummary source={h.source} />);
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});

describe('admin-kit field protection — the controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a per-language control checked and inert under a whole-field protection', async () => {
    const h = harness({
      label: 'Ergonode',
      scopeKey: `whole:${PRODUCT_ID}`,
      initial: view({ protections: [{ fieldPath: 'name', languageCode: null }] }),
    });
    const { container } = renderTree(
      <FieldProtectionToggle source={h.source} fieldPath="name" languageCode="pl-PL" />,
    );
    await waitFor(() => expect(checkboxes(container)).toHaveLength(1));
    expect(checkboxes(container)[0]!.checked).toBe(true);
    expect(checkboxes(container)[0]!.disabled).toBe(true);
  });

  it('names the price list and currency, and renders no panel without a live path', async () => {
    const livePricePaths = [
      {
        fieldPath: `price.${LIST_ID}.PLN`,
        priceListId: LIST_ID,
        priceListName: 'Ergonode prices',
        currencyCode: 'PLN',
      },
    ];
    const withPaths = harness({
      label: 'Ergonode',
      scopeKey: `prices:${PRODUCT_ID}`,
      initial: view({ livePricePaths }),
    });
    const { container } = renderTree(<FieldProtectionPricePanel source={withPaths.source} />);
    await waitFor(() => expect(checkboxes(container)).toHaveLength(1));
    expect(container.textContent).toContain('fieldProtection.field.priceInList');
    expect(container.textContent).toContain('Ergonode prices');

    const without = harness({ label: 'Ergonode', scopeKey: `noprices:${PRODUCT_ID}` });
    const second = renderTree(<FieldProtectionPricePanel source={without.source} />);
    await waitFor(() => expect(without.load).toHaveBeenCalledTimes(1));
    expect(second.container.textContent).toBe('');
  });

  it('renders the structural kind through the owner’s key, whatever the owner’s vocabulary', async () => {
    // The kit knows there *is* a structural kind and not what the kinds are:
    // Ergonode enumerates three and Pimcore six, and neither set is the kit's.
    const h = harness({
      label: 'Pimcore',
      scopeKey: `structure:${PRODUCT_ID}`,
      initial: view({ sourceKind: 'configurable', variantCount: 4 }),
    });
    const { container } = renderTree(<FieldProtectionSummary source={h.source} />);
    await waitFor(() =>
      expect(container.textContent).toContain('fieldProtection.structure.configurable'),
    );
    expect(container.textContent).toContain('fieldProtection.structure.variantCount');
  });

  it('lists what is protected, per language, in the summary', async () => {
    const h = harness({
      label: 'Ergonode',
      scopeKey: `summary:${PRODUCT_ID}`,
      initial: view({
        protections: [
          { fieldPath: 'description', languageCode: 'pl-PL' },
          { fieldPath: 'attributeValues.colour', languageCode: null },
        ],
      }),
    });
    const { container } = renderTree(<FieldProtectionSummary source={h.source} />);
    await waitFor(() =>
      expect(container.textContent).toContain('fieldProtection.summary.item.language'),
    );
    expect(container.textContent).toContain('fieldProtection.field.attribute');
    expect(container.textContent).not.toContain('fieldProtection.summary.none');
  });
});

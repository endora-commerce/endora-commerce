import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { z } from 'zod';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';

/**
 * Issue #98 — `FulfilmentStrategyPicker` offers what the contract declares.
 *
 * The picker used to carry its own copy of the five strategies beside
 * `fulfilmentStrategySchema` in `@endora-commerce/contracts`. A sixth member
 * added to the contract type-checked and never reached the picker, so the
 * operator could not choose it from either of the screens that render it.
 *
 * The contract is mocked here with one member the shipped enum does not have,
 * `nearest_first`. That is the drift the copy could not see: against a list
 * equal to the real one, a hand-copied array and a derived one render the same
 * thing, and the test would pass whether or not the picker derives anything.
 */

const EXTRA = 'nearest_first';

vi.mock('@endora-commerce/contracts', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/contracts')>(
    '@endora-commerce/contracts',
  );
  return {
    ...actual,
    fulfilmentStrategySchema: z.enum([...actual.fulfilmentStrategySchema.options, EXTRA]),
  };
});

const { FulfilmentStrategyPicker } = await import('@endora-commerce/admin-kit/components');
const { fulfilmentStrategySchema: shippedSchema } = await vi.importActual<
  typeof import('@endora-commerce/contracts')
>('@endora-commerce/contracts');

const REPO_ROOT = resolve(process.cwd(), '..');

function coreKeys(language: 'en' | 'pl'): Record<string, string> {
  const raw = readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`), 'utf8');
  return JSON.parse(raw) as Record<string, string>;
}

function renderPicker(allowInherit: boolean): ReturnType<typeof render> {
  const bundle: Bundle = { core: coreKeys('en') };
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language="en" initialBundle={bundle}>
      <>{children}</>
    </TranslationProvider>
  );
  return render(
    <FulfilmentStrategyPicker
      value={{ strategy: null, warehouseOrder: [] }}
      onChange={(): void => {}}
      warehouses={[]}
      allowInherit={allowInherit}
    />,
    { wrapper },
  );
}

function offeredValues(): string[] {
  const select = screen.getByLabelText('Warehouse-picking strategy') as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.value);
}

describe('FulfilmentStrategyPicker — its options are the contract enum', () => {
  it('renders exactly one option per `fulfilmentStrategySchema.options` member, in order', () => {
    const view = renderPicker(false);
    expect(offeredValues()).toEqual([...shippedSchema.options, EXTRA]);
    view.unmount();
  });

  it('puts the inherit option first and adds nothing else', () => {
    const view = renderPicker(true);
    expect(offeredValues()).toEqual(['', ...shippedSchema.options, EXTRA]);
    view.unmount();
  });

  it.each(['en', 'pl'] as const)(
    'has a `fulfilment.strategy.<id>` key for every shipped strategy in %s',
    (language) => {
      const keys = coreKeys(language);
      const missing = shippedSchema.options.filter(
        (id) => typeof keys[`fulfilment.strategy.${id}`] !== 'string' || keys[`fulfilment.strategy.${id}`] === '',
      );
      expect(missing).toEqual([]);
    },
  );
});

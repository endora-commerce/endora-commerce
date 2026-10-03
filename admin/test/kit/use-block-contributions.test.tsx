import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import type { AdminBlockContribution } from '@endora-commerce/contracts';
import {
  selectBlockContributions,
  useBlockContributions,
  type OwnedBlockContribution,
} from '@endora-commerce/admin-kit/zones';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * `specs/141-module-block-renderers/contracts/block-renderers.md` §5.1 — the
 * one reader of the editor renderers a module's `./admin` layer contributes.
 *
 * The registry does not filter and neither does the provider: presence is
 * decided here, at enumeration, through the same predicate zones use, so an
 * operator's activation flip takes effect without a rebuild. And a factory is
 * never called by the enumeration — the editor that wants the renderer calls
 * it — so a module's editor chunk is not fetched for a block nobody opened.
 */

const factory = (): AdminBlockContribution['component'] =>
  vi.fn(() => Promise.resolve({ default: {} }));

function entries(): {
  crmCms: AdminBlockContribution;
  crmEmail: AdminBlockContribution;
  loyaltyCms: AdminBlockContribution;
  all: readonly { moduleId: string; contributions: { blocks: readonly AdminBlockContribution[] } }[];
} {
  const crmCms = { name: 'crm.Badge', context: 'cms' as const, component: factory() };
  const crmEmail = { name: 'crm.Badge', context: 'email' as const, component: factory() };
  const loyaltyCms = { name: 'loyalty.Points', context: 'cms' as const, component: factory() };
  return {
    crmCms,
    crmEmail,
    loyaltyCms,
    all: [
      { moduleId: 'crm', contributions: { blocks: [crmCms, crmEmail] } },
      { moduleId: 'loyalty', contributions: { blocks: [loyaltyCms] } },
    ],
  };
}

function wrapperFor(
  contributions: ReturnType<typeof entries>['all'],
  presence: { present?: readonly string[]; absent?: readonly string[] },
): ({ children }: { children: ReactNode }) => ReactElement {
  return ({ children }) =>
    withSession(<>{children}</>, {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence(presence),
      contributions,
    });
}

describe('useBlockContributions', () => {
  it('returns the contributions of one context, stamped with the module that shipped them', () => {
    const fixture = entries();
    const { result } = renderHook(() => useBlockContributions('cms'), {
      wrapper: wrapperFor(fixture.all, { present: ['crm', 'loyalty'] }),
    });
    expect(result.current.map((entry) => [entry.module, entry.name, entry.context])).toEqual([
      ['crm', 'crm.Badge', 'cms'],
      ['loyalty', 'loyalty.Points', 'cms'],
    ]);
  });

  it('filters by context', () => {
    const fixture = entries();
    const { result } = renderHook(() => useBlockContributions('email'), {
      wrapper: wrapperFor(fixture.all, { present: ['crm', 'loyalty'] }),
    });
    expect(result.current.map((entry) => entry.name)).toEqual(['crm.Badge']);
    expect(result.current[0]?.component).toBe(fixture.crmEmail.component);
  });

  it('drops the contributions of a module that is switched off', () => {
    const fixture = entries();
    const { result } = renderHook(() => useBlockContributions('cms'), {
      wrapper: wrapperFor(fixture.all, { present: ['crm'], absent: ['loyalty'] }),
    });
    expect(result.current.map((entry) => entry.name)).toEqual(['crm.Badge']);
  });

  it('never evaluates a factory', () => {
    const fixture = entries();
    renderHook(() => useBlockContributions('cms'), {
      wrapper: wrapperFor(fixture.all, { present: ['crm', 'loyalty'] }),
    });
    for (const block of [fixture.crmCms, fixture.crmEmail, fixture.loyaltyCms]) {
      expect(block.component).not.toHaveBeenCalled();
    }
  });

  it('answers an empty list when no module contributes a block', () => {
    const { result } = renderHook(() => useBlockContributions('cms'), {
      wrapper: wrapperFor([], { present: ['crm'] }),
    });
    expect(result.current).toEqual([]);
  });
});

describe('selectBlockContributions', () => {
  const owned = (module: string, name: string): OwnedBlockContribution => ({
    module,
    name,
    context: 'cms',
    component: () => Promise.resolve({ default: {} }),
  });

  it('drops a block a module contributes under another module’s name', () => {
    // A block name states its owner. `module` is the registry entry's key and
    // never a declared field, so a package cannot draw a block it does not own
    // by claiming the name.
    const selected = selectBlockContributions(
      [owned('crm', 'crm.Badge'), owned('crm', 'cms.Text'), owned('crm', 'NotNamespaced')],
      'cms',
      () => true,
    );
    expect(selected.map((entry) => entry.name)).toEqual(['crm.Badge']);
  });

  it('asks the visibility predicate about the module, with no permission', () => {
    const isVisible = vi.fn(() => true);
    selectBlockContributions([owned('crm', 'crm.Badge')], 'cms', isVisible);
    expect(isVisible).toHaveBeenCalledWith({ module: 'crm' });
  });
});

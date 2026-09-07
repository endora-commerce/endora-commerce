'use client';

import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@endora-commerce/admin-kit/ui';
import { normalize } from '@endora-commerce/admin-kit/lib';

/**
 * Puck `overrides.drawer` — search box above the component list.
 *
 * The fold is `lib/text-normalization.ts`, **imported, never re-implemented**.
 * This file used to carry its own NFD-only copy, which cannot touch `ł` — so
 * `naglowek` found nothing while `Nagłówek`, the shipped Polish label for the
 * Heading block, sat in the list unmatched (issue #236). Both sides are folded:
 * folding only the haystack breaks the operator who does type the diacritics.
 */
export function PageBuilderDrawer({
  children,
  searchPlaceholder,
  emptyLabel,
}: {
  children: ReactNode;
  searchPlaceholder: string;
  emptyLabel: string;
}): ReactElement {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  useLayoutEffect(() => {
    const root = listRef.current;
    if (!root) return;

    const q = normalize(query);
    const items = root.querySelectorAll<HTMLElement>('[data-puck-drawer-item]');
    let visible = 0;

    items.forEach((el) => {
      const testId = el.getAttribute('data-testid') ?? '';
      const name = testId.startsWith('drawer-item:') ? testId.slice('drawer-item:'.length) : '';
      const label = (el.textContent ?? '').trim();
      const haystack = normalize(`${name} ${label}`);
      const match = q.length === 0 || haystack.includes(q);
      el.style.display = match ? '' : 'none';
      if (match) visible += 1;
    });

    // Hide category groups that have no matching items while filtering.
    root.querySelectorAll<HTMLElement>('[class*="ComponentList_"]').forEach((list) => {
      const className = list.className;
      if (className.includes('ComponentList-content') || className.includes('ComponentList-title')) {
        return;
      }
      if (!list.querySelector('[class*="ComponentList-content"]')) return;
      const anyVisible = [...list.querySelectorAll<HTMLElement>('[data-puck-drawer-item]')].some(
        (el) => el.style.display !== 'none',
      );
      list.style.display = q.length > 0 && !anyVisible ? 'none' : '';
    });

    setMatchCount(q.length > 0 ? visible : null);
  }, [query, children]);

  const filtering = query.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="sticky top-0 z-[1] bg-background px-2 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e): void => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 bg-white pl-8 text-xs"
            aria-label={searchPlaceholder}
          />
        </div>
        {filtering && matchCount === 0 ? (
          <p className="mt-2 px-0.5 text-xs text-muted-foreground">{emptyLabel}</p>
        ) : null}
      </div>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-2"
        {...(filtering ? { 'data-pb-drawer-filtering': '' } : {})}
      >
        {children}
      </div>
    </div>
  );
}

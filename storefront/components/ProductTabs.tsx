'use client';

import { useState, type ReactNode } from 'react';

/**
 * PDP detail tabs — ports the Industria storefront design's `.tabs` /
 * `.tabpanel` section (`specs/b2b-platform-storefront-ui/project/
 * industria-views-pdp.jsx` + `.tabs`/`.tab`/`.tabpanel` in industria-views.css)
 * as Tailwind utilities. Placed full-width below the gallery/buy area.
 *
 * Every panel is rendered in the DOM (inactive ones carry `hidden`) so the
 * product description and specs stay in the server-rendered HTML for SEO; the
 * client only toggles which panel is visible.
 */

export interface ProductTab {
  id: string;
  label: string;
  count?: number;
  panel: ReactNode;
}

export function ProductTabs({ tabs }: { tabs: ProductTab[] }): ReactNode {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  if (tabs.length === 0) return null;
  const activeId = tabs.some((t) => t.id === active) ? active : tabs[0]!.id;

  return (
    <section className="mt-12">
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={isActive}
              aria-controls={`tabpanel-${t.id}`}
              onClick={() => setActive(t.id)}
              className={`-mb-px inline-flex shrink-0 items-center gap-[6px] border-0 border-b-[3px] bg-transparent px-[18px] py-[12px] text-[13px] font-medium outline-none transition-colors focus-visible:border-line-strong focus-visible:text-fg ${
                isActive ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {t.label}
              {t.count != null ? (
                <span className="text-[12px] font-normal text-subtle">({t.count})</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`tabpanel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          hidden={t.id !== activeId}
          className="py-7"
        >
          {t.panel}
        </div>
      ))}
    </section>
  );
}

'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useMemo, useTransition, type ChangeEvent, type ReactNode } from 'react';

/**
 * Bordered toolbar that sits between the catalog title and the product
 * grid. Mirrors `.toolbar` from the Industria design:
 *   left  — "Pokazuję X–Y" hint (mono numerals)
 *   right — sort select + per-page select + grid/list viewmode toggle
 *
 * Stays in sync with the URL: changing any control re-pushes the
 * current pathname with the new param, and `useTransition` keeps the
 * UI responsive while the SSR re-render runs. `baseQuery` carries
 * search params we want to preserve across pushes (q, attribute
 * filters, etc.) — `cursor` is intentionally dropped so pagination
 * rewinds to page 1 when sort/limit/view changes.
 */
export function CatalogToolbar(props: {
  shown: number;
  sort: 'relevance' | '-createdAt' | 'name' | '-name';
  limit: 24 | 48 | 96;
  view: 'grid' | 'list';
  baseQuery: Record<string, string>;
}): ReactNode {
  const router = useRouter();
  const pathname = usePathname() ?? '/catalog';
  const [pending, startTransition] = useTransition();

  const baseEntries = useMemo<Array<[string, string]>>(() => {
    return Object.entries(props.baseQuery).filter(([k]) => k !== 'cursor');
  }, [props.baseQuery]);

  const navigate = (overrides: Record<string, string>): void => {
    const params = new URLSearchParams(baseEntries);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  const onSortChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    const next = e.target.value;
    navigate({ sort: next === 'relevance' ? '' : next });
  };
  const onLimitChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    const next = Number(e.target.value);
    navigate({ limit: next === 24 ? '' : String(next) });
  };
  const onViewChange = (next: 'grid' | 'list'): void => {
    navigate({ view: next === 'grid' ? '' : next });
  };

  return (
    <div
      className="industria-toolbar"
      aria-busy={pending ? 'true' : undefined}
    >
      <div className="industria-toolbar__left">
        Pokazuję <strong>1–{props.shown}</strong> wyników
      </div>
      <div className="industria-toolbar__right">
        <select
          className="industria-select"
          name="sort"
          value={props.sort}
          onChange={onSortChange}
          aria-label="Sortuj"
        >
          <option value="relevance">Sortuj: trafność</option>
          <option value="-createdAt">Najnowsze</option>
          <option value="name">Nazwa A–Z</option>
          <option value="-name">Nazwa Z–A</option>
        </select>
        <select
          className="industria-select"
          name="limit"
          value={String(props.limit)}
          onChange={onLimitChange}
          aria-label="Wyników na stronę"
        >
          <option value="24">24 / strona</option>
          <option value="48">48 / strona</option>
          <option value="96">96 / strona</option>
        </select>
        <div
          className="industria-viewmode"
          role="radiogroup"
          aria-label="Tryb widoku"
        >
          <button
            type="button"
            role="radio"
            aria-checked={props.view === 'grid'}
            aria-label="Siatka"
            className={props.view === 'grid' ? 'is-active' : ''}
            onClick={(): void => onViewChange('grid')}
          >
            <GridIcon />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={props.view === 'list'}
            aria-label="Lista"
            className={props.view === 'list' ? 'is-active' : ''}
            onClick={(): void => onViewChange('list')}
          >
            <ListIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function svg(children: ReactNode, size = 14): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function GridIcon(): ReactNode {
  return svg(
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>,
    14,
  );
}

function ListIcon(): ReactNode {
  return svg(
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </>,
    14,
  );
}

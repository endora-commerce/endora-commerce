import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AdminSearchCapability, AdminSearchGroup } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { getCapability, searchRecords } from '../api.js';

/** Results per record type on this page (FR-029). */
export const RESULTS_PAGE_LIMIT = 20;
const DEBOUNCE_MS = 250;

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly query: string; readonly groups: readonly AdminSearchGroup[] };

/**
 * The full results page (`specs/150-admin-global-search/` User Story 3,
 * contracts/admin-ui.md §2.1): `/global-search?q=&type=`.
 *
 * The address carries the text and the narrowing, so a colleague opening it
 * gets the same search under **their own** permissions and scope (FR-030) —
 * the server decides what any viewer sees. Typing replaces `q` in the address
 * after a pause; a type chip sets `type`. Results are links, so the page is a
 * plain tab order.
 */
export function GlobalSearchPage(): ReactNode {
  const t = useTranslation('admin_search');
  const { language } = useTranslationContext();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type');
  const [text, setText] = useState(q);
  const [capability, setCapability] = useState<AdminSearchCapability | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const inputId = useId();
  const latest = useRef('');

  useEffect(() => {
    let cancelled = false;
    void getCapability(language)
      .then((answer) => {
        if (!cancelled) setCapability(answer);
      })
      .catch(() => {
        if (!cancelled) setCapability({ minimumQueryLength: 3, resultsPerEntity: 5, entityTypes: [] });
      });
    return (): void => {
      cancelled = true;
    };
  }, [language]);

  // The address follows the input after a pause, replacing the entry.
  useEffect(() => {
    if (text === q) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (text.trim() === '') next.delete('q');
      else next.set('q', text);
      setParams(next, { replace: true });
    }, DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [text, q, params, setParams]);

  const minimum = capability?.minimumQueryLength ?? 3;
  const trimmed = q.trim();
  useEffect(() => {
    latest.current = trimmed;
    if (capability === null || trimmed.length < minimum) {
      setOutcome({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setOutcome({ kind: 'loading' });
    void searchRecords({ q: trimmed, language, limit: RESULTS_PAGE_LIMIT, entityType: type }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || response.data.query !== latest.current) return;
        setOutcome({ kind: 'ready', query: response.data.query, groups: response.data.groups });
      })
      .catch(() => {
        if (!controller.signal.aborted) setOutcome({ kind: 'error' });
      });
    return (): void => controller.abort();
  }, [trimmed, type, language, capability, minimum, attempt]);

  const choose = useCallback(
    (entityType: string | null): void => {
      const next = new URLSearchParams(params);
      if (entityType === null) next.delete('type');
      else next.set('type', entityType);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const count = outcome.kind === 'ready' ? outcome.groups.reduce((sum, group) => sum + group.hits.length, 0) : 0;

  return (
    <>
      <PageHeader title={t('page.results.title')} />
      <div className="mb-4 grid gap-2">
        <Label htmlFor={inputId}>{t('page.results.inputLabel')}</Label>
        <Input
          id={inputId}
          type="search"
          value={text}
          placeholder={t('page.results.inputPlaceholder')}
          onChange={(event): void => setText(event.target.value)}
        />
      </div>
      {capability !== null && capability.entityTypes.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('page.results.typesLabel')}>
          <Button type="button" variant="outline" size="sm" aria-pressed={type === null} onClick={(): void => choose(null)}>
            {t('page.results.all')}
          </Button>
          {capability.entityTypes.map((entry) => (
            <Button
              key={entry.entityType}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={type === entry.entityType}
              onClick={(): void => choose(entry.entityType)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div role="status" aria-live="polite" className="sr-only" data-testid="results-status">
        {outcome.kind === 'ready' ? t('page.results.announce', { count }) : ''}
      </div>

      {outcome.kind === 'idle' ? (
        <p className="text-sm text-muted-foreground">{t('page.results.belowMinimum', { minimum })}</p>
      ) : outcome.kind === 'loading' ? (
        <div className="grid gap-2" aria-busy="true" data-testid="results-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : outcome.kind === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t('page.results.error')}{' '}
            <Button type="button" variant="link" className="h-auto p-0" onClick={(): void => setAttempt((n) => n + 1)}>
              {t('page.results.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : outcome.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('page.results.empty', { query: outcome.query })}</p>
      ) : (
        <div className="grid gap-4">
          {outcome.groups.map((group) => (
            <Card key={group.entityType} data-testid={`results-${group.entityType}`}>
              <CardHeader>
                <CardTitle>{group.label}</CardTitle>
              </CardHeader>
              <CardContent>
                {group.status !== 'ok' ? (
                  <p className="text-sm text-muted-foreground">{t('page.results.unavailable', { label: group.label })}</p>
                ) : (
                  <ul className="grid gap-1">
                    {group.hits.map((hit) => (
                      <li key={hit.id}>
                        <Link
                          to={hit.targetRoute}
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="min-w-0">
                            <span className="block font-medium">{hit.title}</span>
                            {hit.subtitle ? (
                              <span className="block text-xs text-muted-foreground">{hit.subtitle}</span>
                            ) : null}
                          </span>
                          {hit.status ? <Badge variant="secondary">{hit.status.label}</Badge> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {group.hasMore ? (
                  <p className="mt-2 text-xs text-muted-foreground">{t('page.results.more')}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default GlobalSearchPage;

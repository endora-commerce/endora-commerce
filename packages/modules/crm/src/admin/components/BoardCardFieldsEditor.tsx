import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { OpportunityBoardCardConfig, OpportunityBoardCardField } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { boardFieldLabel } from '../lib/board-fields.js';
import { errorMessage } from '../lib/labels.js';

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((ref, index) => ref === b[index]);

/**
 * Which fields a board card shows, and in what order
 * (`specs/143-crm-sales-opportunities/`, User Story 19 — FR-090).
 *
 * Two lists: what the card shows, in its order, and what can be added. A field
 * is moved with *Move up* / *Move down* — buttons, so the order is set without
 * a drag (WCAG 2.2 SC 2.5.7) — and the limit is said before it is reached:
 * once the card is full, *Add* is disabled and the count says why.
 *
 * Nothing is stored until *Save*; the answer is the server's own, so a field
 * that stopped existing meanwhile is gone from both lists afterwards.
 */
export function BoardCardFieldsEditor(): ReactNode {
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const [config, setConfig] = useState<OpportunityBoardCardConfig | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const accept = useCallback((loaded: OpportunityBoardCardConfig): void => {
    setConfig(loaded);
    setChosen(loaded.fields.map((field) => field.ref));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      accept(await crmApi.getBoardCardFields());
    } catch {
      setLoadFailed(true);
    }
  }, [accept]);

  useEffect(() => {
    void load();
  }, [load]);

  const byRef = useMemo(
    () => new Map((config?.available ?? []).map((field) => [field.ref, field])),
    [config],
  );

  if (config === null) {
    return loadFailed ? (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('boardCard.error.load')}</span>
          <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
            {tCore('common.action.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        {tCore('common.state.loading')}
      </p>
    );
  }

  const name = (field: OpportunityBoardCardField): string => boardFieldLabel(field, language, t);
  const shown = chosen
    .map((ref) => byRef.get(ref))
    .filter((field): field is OpportunityBoardCardField => field !== undefined);
  const addable = config.available.filter((field) => !chosen.includes(field.ref));
  const full = chosen.length >= config.maxFields;
  const dirty = !sameOrder(chosen, config.fields.map((field) => field.ref));

  const edit = (next: string[]): void => {
    setChosen(next);
    setError(null);
    setNotice('');
  };
  const move = (index: number, by: -1 | 1): void => {
    const next = [...chosen];
    const [ref] = next.splice(index, 1);
    if (ref === undefined) return;
    next.splice(index + by, 0, ref);
    edit(next);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setNotice('');
    try {
      accept(await crmApi.setBoardCardFields(chosen));
      setNotice(t('boardCard.saved'));
    } catch (failure) {
      setError(errorMessage(failure, t('boardCard.error.save')));
    } finally {
      setSaving(false);
    }
  };

  const group = (source: OpportunityBoardCardField['source']): ReactNode => {
    const fields = addable.filter((field) => field.source === source);
    const everyOffered = config.available.some((field) => field.source === source);
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(`boardCard.available.${source}`)}
        </h4>
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(everyOffered ? 'boardCard.available.allShown' : 'boardCard.available.noCustom')}
          </p>
        ) : (
          <ul role="list" className="flex flex-wrap gap-2">
            {fields.map((field) => (
              <li key={field.ref}>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-8"
                  disabled={full || saving}
                  aria-label={t('boardCard.add', { field: name(field) })}
                  onClick={(): void => edit([...chosen, field.ref])}
                >
                  <Plus aria-hidden="true" />
                  {name(field)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <section aria-labelledby="crm-board-card-shown" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="crm-board-card-shown" className="text-sm font-semibold">
            {t('boardCard.shown.title')}
          </h3>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('boardCard.shown.count', { count: chosen.length, max: config.maxFields })}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{t('boardCard.shown.titleAlways')}</p>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('boardCard.shown.empty')}</p>
        ) : (
          <ol className="divide-y rounded-md border">
            {shown.map((field, index) => (
              <li key={field.ref} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 break-words text-sm">
                  <span className="mr-2 tabular-nums text-muted-foreground">{index + 1}.</span>
                  {name(field)}
                </span>
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-8"
                    disabled={index === 0 || saving}
                    aria-label={t('boardCard.moveUp', { field: name(field) })}
                    onClick={(): void => move(index, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-8"
                    disabled={index === shown.length - 1 || saving}
                    aria-label={t('boardCard.moveDown', { field: name(field) })}
                    onClick={(): void => move(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-8"
                    disabled={saving}
                    aria-label={t('boardCard.remove', { field: name(field) })}
                    onClick={(): void => edit(chosen.filter((ref) => ref !== field.ref))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="crm-board-card-available" className="space-y-3">
        <h3 id="crm-board-card-available" className="text-sm font-semibold">
          {t('boardCard.available.title')}
        </h3>
        {full ? (
          <p className="text-sm text-muted-foreground">{t('boardCard.available.full', { max: config.maxFields })}</p>
        ) : null}
        {group('builtin')}
        {group('custom')}
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="min-h-11 sm:min-h-9"
          disabled={!dirty || saving}
          aria-busy={saving}
          onClick={(): void => void save()}
        >
          {tCore('common.action.save')}
        </Button>
        {dirty && !saving ? (
          <Button
            variant="ghost"
            className="min-h-11 sm:min-h-9"
            onClick={(): void => edit(config.fields.map((field) => field.ref))}
          >
            {t('boardCard.discard')}
          </Button>
        ) : null}
        {/* Mounted before it has text, so the confirmation is spoken reliably. */}
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      </div>
    </div>
  );
}

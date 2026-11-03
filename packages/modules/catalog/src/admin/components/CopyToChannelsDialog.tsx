import { useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CopyScopedValueRequest, CopyScopedValueResponse } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Checkbox } from '@endora-commerce/admin-kit/ui';
import { copyScopedValue } from '../lib/scoped-values-api.js';

/**
 * Feature 170 (T116; `contracts/editor-ui.md` §8, `contracts/scoped-values-api.md` §4, FR-086) —
 * "Copy to other channels in <language>". Lists the member channels that offer the language as
 * checkboxes (all ticked), plans the copy with a dry run on every selection, lists the channels
 * whose own value the copy overwrites, and only then offers the copy: one audited Command
 * (`product.scoped_values.copy_to_channels`). It stages nothing in the editor; the copy bumps the
 * product's version, which `onCopied` hands back so the next Save sends it.
 */

export interface CopyTarget {
  channelId: string;
  name: string;
}

export interface CopyToChannelsDialogProps {
  productId: string;
  fieldPath: string;
  fieldLabel: string;
  /** The source scope (Channel × language) and its words. */
  from: { channelId: string; languageCode: string };
  sourceScopeLabel: string;
  languageName: string;
  /** The source's own value; `null` for an own empty value (offered on optional fields only). */
  value: string | null;
  /** The other member channels that offer the language; the source channel is not among them. */
  targets: readonly CopyTarget[];
  version: string;
  onClose(): void;
  onCopied(version: string, count: number): void;
  finalFocusRef?: RefObject<HTMLElement | null>;
}

/** The editor's paths are plain strings; the route validates the field (`not_supported`). */
const asField = (path: string): CopyScopedValueRequest['field'] => path as CopyScopedValueRequest['field'];

type Check =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; overwrites: CopyScopedValueResponse['data']['overwrites'] };

export function CopyToChannelsDialog(props: CopyToChannelsDialogProps): ReactNode {
  const { productId, fieldPath, fieldLabel, from, sourceScopeLabel, languageName, value, targets, version, onClose, onCopied, finalFocusRef } =
    props;
  const t = useTranslation('catalog');
  const adminLanguage = useContext(AppLanguageContext)?.language ?? 'en';
  const plural = (key: string, count: number): string =>
    t(`${key}.${new Intl.PluralRules(adminLanguage).select(count)}`, { count: String(count), field: fieldLabel });

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(targets.map((target) => target.channelId)));
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const toChannelIds = targets.map((target) => target.channelId).filter((id) => selected.has(id));
  const selectionKey = toChannelIds.join(',');

  const errorText = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof ApiError && err.status === 409) return t('productEditor.copy.conflict');
      if (err instanceof ApiError && err.status === 422) return `${fallback} ${err.envelope.error.message}`;
      return fallback;
    },
    [t],
  );

  // The dry run: on open, on every selection and on "Try again".
  useEffect(() => {
    const request = ++requestRef.current;
    if (selectionKey === '') {
      setCheck({ state: 'idle' });
      return;
    }
    setCheck({ state: 'loading' });
    setCopyError(null);
    copyScopedValue(productId, { field: asField(fieldPath), from, toChannelIds: selectionKey.split(','), version, dryRun: true }).then(
      (res) => {
        if (request === requestRef.current) setCheck({ state: 'ready', overwrites: res.data.overwrites });
      },
      (err: unknown) => {
        if (request === requestRef.current) setCheck({ state: 'error', message: errorText(err, t('productEditor.copy.checkError')) });
      },
    );
    // `from` is a fresh object per render; its two strings are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, fieldPath, from.channelId, from.languageCode, selectionKey, version, attempt, errorText, t]);

  const canCopy = check.state === 'ready' && toChannelIds.length > 0 && !copying;
  const runCopy = (): void => {
    if (!canCopy) return;
    setCopying(true);
    setCopyError(null);
    copyScopedValue(productId, { field: asField(fieldPath), from, toChannelIds, version }).then(
      (res) => {
        setCopying(false);
        onCopied(res.data.version, res.data.applied);
      },
      (err: unknown) => {
        setCopying(false);
        setCopyError(errorText(err, t('productEditor.copy.copyError')));
      },
    );
  };

  const toggle = (channelId: string, on: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(channelId);
      else next.delete(channelId);
      return next;
    });
  };

  const nameOf = (channelId: string): string => targets.find((target) => target.channelId === channelId)?.name ?? channelId.slice(0, 8);
  const titleText = t('productEditor.copy.title', { field: fieldLabel, language: languageName });

  return (
    <ModalDialog
      title={titleText}
      onClose={onClose}
      busy={copying}
      dismissOnScrim={false}
      aria-describedby="copy-to-channels-intro"
      {...(finalFocusRef ? { finalFocusRef } : {})}
      footer={
        <>
          <Button type="button" variant="outline" disabled={copying} onClick={onClose}>
            {t('productEditor.copy.cancel')}
          </Button>
          <Button type="button" className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50" aria-disabled={canCopy ? undefined : true} aria-busy={copying || undefined} onClick={runCopy}>
            {plural('productEditor.copy.confirm', toChannelIds.length)}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p id="copy-to-channels-intro" className="m-0">
          {t('productEditor.copy.intro', { scope: sourceScopeLabel, field: fieldLabel, language: languageName })}
        </p>
        <div>
          <p className="m-0 text-xs text-muted-foreground">{t('productEditor.copy.value')}</p>
          <p className="m-0 mt-1 whitespace-pre-wrap break-words rounded-md border bg-secondary px-3 py-2">
            {value === null || value === '' ? t('productEditor.copy.valueEmpty') : value}
          </p>
        </div>

        {targets.length === 0 ? (
          <p className="m-0 text-muted-foreground">{t('productEditor.copy.noTargets', { language: languageName })}</p>
        ) : (
          <fieldset className="m-0 space-y-1 border-0 p-0">
            <legend className="mb-1 text-xs text-muted-foreground">{t('productEditor.copy.targets', { language: languageName })}</legend>
            {targets.map((target) => (
              <label key={target.channelId} className="flex min-h-6 items-center gap-2 py-1 max-lg:min-h-11">
                <Checkbox
                  checked={selected.has(target.channelId)}
                  disabled={copying}
                  onChange={(event): void => toggle(target.channelId, event.currentTarget.checked)}
                />
                <span>{target.name}</span>
              </label>
            ))}
          </fieldset>
        )}

        <div aria-live="polite">
          {toChannelIds.length === 0 && targets.length > 0 ? (
            <p className="m-0 text-muted-foreground">{t('productEditor.copy.selectOne')}</p>
          ) : null}
          {check.state === 'loading' ? (
            <p className="m-0 text-muted-foreground" aria-busy="true">
              {t('productEditor.copy.checking')}
            </p>
          ) : null}
          {check.state === 'ready' && check.overwrites.length === 0 ? (
            <p className="m-0">{t('productEditor.copy.noOverwrites')}</p>
          ) : null}
          {check.state === 'ready' && check.overwrites.length > 0 ? (
            <div>
              <p id="copy-to-channels-overwrites" className="m-0 font-medium">
                {t('productEditor.copy.overwrites')}
              </p>
              <ul aria-labelledby="copy-to-channels-overwrites" className="m-0 mt-1 list-disc space-y-1 pl-5">
                {check.overwrites.map((row) => (
                  <li key={row.channelId}>
                    <span className="font-medium">{nameOf(row.channelId)}</span>
                    {': '}
                    <span className="break-words">
                      {typeof row.currentValue === 'string' ? row.currentValue : t('productEditor.copy.currentEmpty')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {check.state === 'error' ? (
          <Alert variant="destructive">
            <AlertDescription>
              <span>{check.message}</span>
              <Button type="button" variant="outline" size="sm" className="ml-2" onClick={(): void => setAttempt((n) => n + 1)}>
                {t('productEditor.copy.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {copyError ? (
          <Alert variant="destructive">
            <AlertDescription>{copyError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ModalDialog>
  );
}

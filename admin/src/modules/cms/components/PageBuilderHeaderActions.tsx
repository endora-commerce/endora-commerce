'use client';

import { useMemo, useState, type ReactElement } from 'react';
import type { Data } from '@measured/puck';
import { Copy, Eraser, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { isEmptyPageBuilderData } from './page-builder-data';

export function PageBuilderHeaderActions({
  fullscreen,
  onToggleFullscreen,
  languages = [],
  activeLanguage = null,
  currentData,
  onCopyFromLanguage,
  onClearCanvas,
  t,
}: {
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  languages?: string[];
  activeLanguage?: string | null;
  currentData: Data | null;
  /** Resolve + apply content from another language into the current canvas. */
  onCopyFromLanguage?: (sourceLanguage: string) => void | Promise<void>;
  onClearCanvas?: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}): ReactElement {
  const [copyOpen, setCopyOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const otherLanguages = useMemo(
    () => languages.filter((lang) => lang !== activeLanguage),
    [activeLanguage, languages],
  );
  const canCopy = Boolean(onCopyFromLanguage) && otherLanguages.length > 0;
  const canClear = Boolean(onClearCanvas) && !isEmptyPageBuilderData(currentData);

  const runCopy = async (): Promise<void> => {
    if (!onCopyFromLanguage || !sourceLanguage) return;
    setBusy(true);
    setMessage(null);
    try {
      await onCopyFromLanguage(sourceLanguage);
      setCopyOpen(false);
      setSourceLanguage('');
      setMessage(t('pageBuilder.copyLanguage.success', { language: sourceLanguage }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {onCopyFromLanguage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canCopy}
            title={
              otherLanguages.length === 0
                ? t('pageBuilder.copyLanguage.noTargets')
                : t('pageBuilder.copyLanguage.button')
            }
            onClick={(): void => {
              setMessage(null);
              setSourceLanguage(otherLanguages[0] ?? '');
              setCopyOpen(true);
            }}
          >
            <Copy className="mr-1 h-4 w-4" />
            {t('pageBuilder.copyLanguage.button')}
          </Button>
        ) : null}
        {onClearCanvas ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!canClear}
            onClick={(): void => {
              setMessage(null);
              setClearOpen(true);
            }}
          >
            <Eraser className="mr-1 h-4 w-4" />
            {t('pageBuilder.clearCanvas.button')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleFullscreen}
          aria-pressed={fullscreen}
        >
          {fullscreen ? (
            <>
              <Minimize2 className="mr-1 h-4 w-4" />
              {t('pageBuilder.fullscreen.exit')}
            </>
          ) : (
            <>
              <Maximize2 className="mr-1 h-4 w-4" />
              {t('pageBuilder.fullscreen.enter')}
            </>
          )}
        </Button>
      </div>

      {message ? <p className="sr-only" role="status">{message}</p> : null}

      {copyOpen ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
          style={{ zIndex: 10000 }}
          role="presentation"
          onPointerDown={(e): void => {
            if (e.target === e.currentTarget && !busy) setCopyOpen(false);
          }}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pb-copy-lang-title"
            onPointerDown={(e): void => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h2 id="pb-copy-lang-title" className="text-lg font-semibold">
                {t('pageBuilder.copyLanguage.title')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('pageBuilder.copyLanguage.description', {
                  target: activeLanguage ?? '—',
                })}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pb-copy-lang-select">{t('pageBuilder.copyLanguage.sourceLabel')}</Label>
              <Select
                id="pb-copy-lang-select"
                value={sourceLanguage}
                onChange={(e): void => setSourceLanguage(e.target.value)}
                disabled={busy}
              >
                {otherLanguages.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </Select>
            </div>
            {message && copyOpen ? (
              <p className="text-sm text-destructive">{message}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setCopyOpen(false)}>
                {t('pageBuilder.copyLanguage.cancel')}
              </Button>
              <Button
                type="button"
                disabled={busy || !sourceLanguage}
                onClick={(): void => void runCopy()}
              >
                {busy ? t('common.saving') : t('pageBuilder.copyLanguage.confirm')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {clearOpen ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
          style={{ zIndex: 10000 }}
          role="presentation"
          onPointerDown={(e): void => {
            if (e.target === e.currentTarget) setClearOpen(false);
          }}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pb-clear-title"
            onPointerDown={(e): void => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h2 id="pb-clear-title" className="text-lg font-semibold">
                {t('pageBuilder.clearCanvas.title')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('pageBuilder.clearCanvas.description')}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={(): void => setClearOpen(false)}>
                {t('pageBuilder.clearCanvas.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={(): void => {
                  onClearCanvas?.();
                  setClearOpen(false);
                }}
              >
                {t('pageBuilder.clearCanvas.confirm')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

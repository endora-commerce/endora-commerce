import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CmsColorPaletteEntry } from '@endora-commerce/contracts';
import { Button, ColorPicker } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { BRAND_COLOR_ROLES, type BrandColorRole } from '@endora-commerce/page-builder-core';

const HEX = /^#[0-9a-fA-F]{6}$/;

function ColorPaletteAddForm({
  saving,
  error,
  onAdd,
}: {
  saving: boolean;
  error: string | null;
  onAdd: (name: string, hex: string) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#1d4ed8');

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">{t('pageBuilder.colorPalette.addTitle')}</h3>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <label className="block text-sm">
        <span className="mb-1 block">{t('pageBuilder.colorPalette.nameLabel')}</span>
        <input
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder={t('pageBuilder.colorPalette.namePlaceholder')}
        />
      </label>
      <div>
        <span className="mb-1 block text-sm">{t('pageBuilder.colorPalette.colorLabel')}</span>
        <ColorPicker
          value={hex}
          onChange={setHex}
          label={t('pageBuilder.colorPalette.colorLabel')}
          customLabel={t('pageBuilder.colorPalette.customColor')}
          presets={[]}
        />
      </div>
      <Button
        type="button"
        disabled={saving}
        onClick={(): void => {
          void onAdd(name, hex).then(() => {
            setName('');
            setHex('#1d4ed8');
          });
        }}
      >
        {t('pageBuilder.colorPalette.add')}
      </Button>
    </div>
  );
}

/**
 * Feature 163, T040 (research R-6) — the brand colour roles, listed before the
 * saved colours when picking. Choosing one stores `token:<role>`, so the block
 * follows the brand screen; the swatch shows the role's effective colour.
 */
function BrandColorList({
  colors,
  onPick,
}: {
  colors: Partial<Record<BrandColorRole, string>>;
  onPick: (value: string) => void;
}): ReactNode {
  const t = useTranslation('core');
  // Literal keys, one per role: the key walk of `chrome-core-namespace.test.tsx` reads string literals only.
  const roleLabels: Record<BrandColorRole, string> = {
    primary: t('pageBuilder.colorPalette.role.primary'),
    'primary-hover': t('pageBuilder.colorPalette.role.primary-hover'),
    secondary: t('pageBuilder.colorPalette.role.secondary'),
    'secondary-hover': t('pageBuilder.colorPalette.role.secondary-hover'),
    'on-primary': t('pageBuilder.colorPalette.role.on-primary'),
    'on-secondary': t('pageBuilder.colorPalette.role.on-secondary'),
  };
  return (
    <section className="mb-4 space-y-2" aria-labelledby="pb-brand-colors-title">
      <h3 id="pb-brand-colors-title" className="text-sm font-medium">
        {t('pageBuilder.colorPalette.brandTitle')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('pageBuilder.colorPalette.brandHint')}</p>
      <ul className="grid grid-cols-2 gap-2">
        {BRAND_COLOR_ROLES.map((entry) => {
          const hex = colors[entry.role] ?? entry.fallback;
          return (
            <li key={entry.role}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left hover:bg-muted"
                onClick={(): void => onPick(entry.value)}
              >
                <span
                  className="size-8 shrink-0 rounded-full border border-black/10"
                  style={{ backgroundColor: hex }}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{roleLabels[entry.role]}</span>
                  <span className="block font-mono text-xs uppercase text-muted-foreground">{hex}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ColorPaletteModal({
  open,
  entries,
  pickMode,
  brandColors,
  onClose,
  onPick,
  onSave,
}: {
  open: boolean;
  entries: CmsColorPaletteEntry[];
  pickMode: boolean;
  /** When set, picking lists the brand colour roles first (their effective colours, where known). */
  brandColors?: Partial<Record<BrandColorRole, string>> | undefined;
  onClose: () => void;
  /** Receives `#rrggbb`, or `token:<role>` for a brand colour. */
  onPick: (value: string) => void;
  onSave: (entries: CmsColorPaletteEntry[]) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const [localEntries, setLocalEntries] = useState(entries);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Issue #313 — the colour whose removal is being confirmed, inline in its row
  // rather than in the browser's `confirm()` (a second modal over this one).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusDeleteAfterCancel = useRef<string | null>(null);

  useEffect(() => {
    if (confirmingId !== null || focusDeleteAfterCancel.current === null) return;
    deleteButtons.current.get(focusDeleteAfterCancel.current)?.focus();
    focusDeleteAfterCancel.current = null;
  }, [confirmingId]);

  useEffect(() => {
    if (open) {
      setLocalEntries(entries);
      setConfirmingId(null);
      setError(null);
    }
  }, [open, entries]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const persist = async (next: CmsColorPaletteEntry[]): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setLocalEntries(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const addColor = async (name: string, hex: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('pageBuilder.colorPalette.nameRequired'));
      return;
    }
    if (!HEX.test(hex)) {
      setError(t('pageBuilder.colorPalette.invalidHex'));
      return;
    }
    const next: CmsColorPaletteEntry = {
      id: crypto.randomUUID(),
      name: trimmed,
      hex: hex.toLowerCase(),
    };
    await persist([...localEntries, next]);
  };

  const removeColor = async (id: string): Promise<void> => {
    setConfirmingId(null);
    await persist(localEntries.filter((entry) => entry.id !== id));
  };

  const cancelRemove = (id: string): void => {
    focusDeleteAfterCancel.current = id;
    setConfirmingId(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('pageBuilder.colorPalette.title')}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-4 shadow-lg"
        onClick={(e): void => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t('pageBuilder.colorPalette.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {pickMode ? t('pageBuilder.colorPalette.pickHint') : t('pageBuilder.colorPalette.description')}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t('pageBuilder.colorPalette.close')}
          </Button>
        </div>

        {pickMode && brandColors ? <BrandColorList colors={brandColors} onPick={onPick} /> : null}
        {pickMode && brandColors ? (
          <h3 className="mb-2 text-sm font-medium">{t('pageBuilder.colorPalette.savedTitle')}</h3>
        ) : null}
        <ul className="mb-4 space-y-2">
          {localEntries.length === 0 ? (
            <li className="text-sm text-muted-foreground">{t('pageBuilder.colorPalette.empty')}</li>
          ) : (
            localEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={(): void => {
                    if (pickMode) onPick(entry.hex);
                  }}
                >
                  <span
                    className="size-8 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: entry.hex }}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{entry.name}</span>
                    <span className="block font-mono text-xs uppercase text-muted-foreground">{entry.hex}</span>
                  </span>
                </button>
                {!pickMode && confirmingId === entry.id ? (
                  <div role="group" aria-label={t('pageBuilder.colorPalette.deleteConfirm')} className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-sm">{t('pageBuilder.colorPalette.deleteConfirm')}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      autoFocus
                      disabled={saving}
                      onClick={(): void => cancelRemove(entry.id)}
                    >
                      {t('common.action.cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={saving}
                      onClick={(): void => void removeColor(entry.id)}
                    >
                      {t('pageBuilder.colorPalette.delete')}
                    </Button>
                  </div>
                ) : !pickMode ? (
                  <Button
                    ref={(node): void => {
                      if (node) deleteButtons.current.set(entry.id, node);
                      else deleteButtons.current.delete(entry.id);
                    }}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={(): void => setConfirmingId(entry.id)}
                  >
                    {t('pageBuilder.colorPalette.delete')}
                  </Button>
                ) : null}
              </li>
            ))
          )}
        </ul>

        <ColorPaletteAddForm saving={saving} error={error} onAdd={addColor} />
      </div>
    </div>
  );
}

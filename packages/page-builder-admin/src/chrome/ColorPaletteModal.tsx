import { useEffect, useState, type ReactNode } from 'react';
import type { CmsColorPaletteEntry } from '@endora-commerce/contracts';
import { Button, ColorPicker } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

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

export function ColorPaletteModal({
  open,
  entries,
  pickMode,
  onClose,
  onPick,
  onSave,
}: {
  open: boolean;
  entries: CmsColorPaletteEntry[];
  pickMode: boolean;
  onClose: () => void;
  onPick: (hex: string) => void;
  onSave: (entries: CmsColorPaletteEntry[]) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const [localEntries, setLocalEntries] = useState(entries);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLocalEntries(entries);
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
    if (!window.confirm(t('pageBuilder.colorPalette.deleteConfirm'))) return;
    await persist(localEntries.filter((entry) => entry.id !== id));
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
                {!pickMode ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={(): void => void removeColor(entry.id)}
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

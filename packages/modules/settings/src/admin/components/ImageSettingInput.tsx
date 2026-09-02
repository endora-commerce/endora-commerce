import { useState, type ReactNode } from 'react';
import { Button, Input } from '@endora-commerce/admin-kit/ui';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AssetUploader } from '@endora-commerce/admin-kit/components';

interface Props {
  /** The current value — a resolvable image URL (may be empty). */
  value: string;
  /** Emit the new URL when the admin uploads, clears, or edits the value. */
  onChange: (next: string) => void;
}

/**
 * `toAbsoluteAssetUrl` is `@endora-commerce/admin-kit/lib`'s, imported above.
 *
 * This file carried its own copy of it, over a private
 * `import.meta.env.VITE_API_BASE_URL` read with the same
 * `http://localhost:3001` fallback — a ninth implementation of a function P4c
 * published, invisible to that merge request because a copy in a module's own
 * file is not a *cross-module* reach. The move refuses it in the compiler
 * rather than in review: this package's `tsconfig.ui.json` carries no
 * `vite/client` types, so `import.meta.env` does not compile here.
 *
 * The two things this copy did that the kit's did not — trimming, and treating
 * a protocol-relative URL as already absolute — went into the kit's rather than
 * being lost, so nothing this screen renders changes. That is batch 9's
 * `AssetDetailDrawer` repair arriving with one extra behaviour to carry.
 */

/**
 * Editor for string settings that hold an image URL (e.g. the product-image
 * placeholder). Instead of forcing the admin to paste a URL, it offers a
 * drag-and-drop / file-picker uploader (via the Assets Library) and stores the
 * resulting public asset URL as the setting value. A live preview is shown for
 * the current value, and a collapsible field still allows pasting a raw URL for
 * power users / externally-hosted images.
 */
export function ImageSettingInput({ value, onChange }: Props): ReactNode {
  const t = useTranslation('settings');
  const [showUrl, setShowUrl] = useState(false);

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center gap-3 rounded-md border bg-muted/20 p-2">
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img
            src={toAbsoluteAssetUrl(value)}
            className="h-16 w-16 shrink-0 rounded border bg-background object-cover"
          />
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{value}</p>
          <Button type="button" variant="ghost" size="sm" onClick={(): void => onChange('')}>
            {t('editor.image.remove')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('editor.image.none')}</p>
      )}

      <AssetUploader
        acceptPrefix="image/"
        defaults={{ visibility: 'public' }}
        onUploaded={(asset): void => onChange(toAbsoluteAssetUrl(asset.url))}
        triggerLabel={t('editor.image.upload')}
      />

      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        onClick={(): void => setShowUrl((s) => !s)}
      >
        {t('editor.image.toggleUrl')}
      </button>
      {showUrl ? (
        <Input
          value={value}
          onChange={(e): void => onChange(e.target.value)}
          placeholder={t('editor.image.urlPlaceholder')}
        />
      ) : null}
    </div>
  );
}

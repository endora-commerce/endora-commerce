import { useEffect, useId, useState, type ReactNode } from 'react';
import { Globe, Languages, LayoutGrid, Lock, TriangleAlert } from 'lucide-react';
import type { ScopeRef } from '@endora-commerce/contracts';
import { Combobox, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { languageName, type ValidScopes } from '../lib/editor-scope.js';

/**
 * Feature 172 (T094, `contracts/editor-ui.md` §2 and §11) — the product editor's one scope
 * switcher: a sales-channel select ("All channels" + the member channels, a searchable
 * combobox past eight options), a language select by name, the scope in words with a link to
 * the scope map, the banner of a non-Global scope and the read-only line.
 *
 * The banner is visual: the editor's own live region announces the new scope after its data
 * has loaded (WCAG 4.1.3), so the switch is not announced twice or before the fields are in. Picking a scope here asks the page (`onRequestScope`), which runs the switch
 * guard before anything changes.
 */

/** More options than this and the channel select becomes a searchable combobox (FR-055). */
export const CHANNEL_SELECT_THRESHOLD = 8;

export interface ProductScopeBarProps {
  scope: ScopeRef;
  validScopes: ValidScopes | null;
  scopeWords: string;
  readOnly: boolean;
  adminLanguage: string;
  onRequestScope(scope: ScopeRef, note?: string): void;
  onOpenScopeMap(): void;
  /** The completeness line of the scope (§9), from saved values. */
  completeness?: ReactNode;
}

export function ProductScopeBar(props: ProductScopeBarProps): ReactNode {
  const { scope, validScopes, scopeWords, readOnly, adminLanguage, onRequestScope, onOpenScopeMap, completeness } = props;
  const t = useTranslation('catalog');
  const channelId = useId();
  const languageId = useId();
  const hintId = useId();
  const channels = validScopes?.channels ?? [];
  const currentChannelId = scope.level === 'global' ? '' : scope.channelId;
  const currentChannel = channels.find((c) => c.channelId === currentChannelId) ?? null;
  const currentLanguage = scope.level === 'channel_language' ? scope.languageCode : '';

  // The banner text is set after mount (the region exists empty first) and changes with the scope only.
  const [bannerText, setBannerText] = useState('');
  useEffect(() => {
    setBannerText(scope.level === 'global' ? '' : t('productEditor.scope.banner', { scope: scopeWords }));
  }, [scope.level, scopeWords, t]);

  const pickChannel = (next: string): void => {
    if (next === '') {
      onRequestScope({ level: 'global' });
      return;
    }
    const channel = channels.find((c) => c.channelId === next);
    if (scope.level === 'channel_language' && channel) {
      const offered = channel.languages.some((l) => l.code.toLowerCase() === scope.languageCode.toLowerCase());
      if (offered) {
        onRequestScope({ level: 'channel_language', channelId: next, languageCode: scope.languageCode });
        return;
      }
      onRequestScope(
        { level: 'channel', channelId: next },
        t('productEditor.scope.languageFallback', {
          channel: channel.name,
          language: languageName(validScopes ?? { channels: [] }, null, scope.languageCode, adminLanguage),
        }),
      );
      return;
    }
    onRequestScope({ level: 'channel', channelId: next });
  };

  const pickLanguage = (next: string): void => {
    if (scope.level === 'global') return;
    onRequestScope(
      next === ''
        ? { level: 'channel', channelId: scope.channelId }
        : { level: 'channel_language', channelId: scope.channelId, languageCode: next },
    );
  };

  const channelOptions = [
    { value: '', label: t('productEditor.scope.allChannels') },
    ...channels.map((c) => ({ value: c.channelId, label: c.name })),
  ];
  const noChannels = validScopes !== null && channels.length === 0;

  return (
    <>
      <section
        aria-label={t('productEditor.scope.region')}
        className="mb-4 rounded-lg border bg-card p-3 lg:sticky lg:top-0 lg:z-10"
        data-testid="product-scope-bar"
      >
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-[12rem] flex-col gap-1">
            <Label htmlFor={channelId}>{t('productEditor.scope.channelSelect')}</Label>
            {channelOptions.length > CHANNEL_SELECT_THRESHOLD ? (
              <Combobox
                id={channelId}
                options={channelOptions}
                value={currentChannelId}
                onChange={(value): void => pickChannel(value ?? '')}
                ariaLabel={t('productEditor.scope.channelSelect')}
              />
            ) : (
              <Select
                id={channelId}
                className="max-lg:min-h-11"
                value={currentChannelId}
                disabled={noChannels}
                aria-describedby={noChannels ? hintId : undefined}
                onChange={(e): void => pickChannel(e.target.value)}
              >
                {channelOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="flex min-w-[12rem] flex-col gap-1">
            <Label htmlFor={languageId}>{t('productEditor.scope.languageSelect')}</Label>
            <Select
              id={languageId}
              className="max-lg:min-h-11"
              value={currentLanguage}
              disabled={scope.level === 'global'}
              aria-describedby={scope.level === 'global' ? `${languageId}-hint` : undefined}
              onChange={(e): void => pickLanguage(e.target.value)}
            >
              <option value="">{t('productEditor.scope.allLanguages')}</option>
              {(currentChannel?.languages ?? []).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name || languageName(validScopes ?? { channels: [] }, currentChannelId, l.code, adminLanguage)}
                </option>
              ))}
            </Select>
            {scope.level === 'global' ? (
              <span id={`${languageId}-hint`} className="text-xs text-muted-foreground">
                {t('productEditor.scope.pickChannelFirst')}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('productEditor.scope.editing')}</span>
            <span className="inline-flex items-center gap-1 font-medium" data-testid="scope-words">
              {scope.level === 'global' ? <Globe className="size-4" aria-hidden="true" /> : null}
              {scope.level === 'channel_language' ? <Languages className="size-4" aria-hidden="true" /> : null}
              {scopeWords}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 self-start text-sm text-primary underline underline-offset-2 max-lg:min-h-11"
              onClick={onOpenScopeMap}
            >
              <LayoutGrid className="size-3.5" aria-hidden="true" />
              {t('productEditor.scope.scopeMap')}
            </button>
          </div>
        </div>
        {noChannels ? (
          <p id={hintId} className="mt-2 text-sm text-muted-foreground">
            {t('productEditor.scope.noChannels')}
          </p>
        ) : null}
        <div
          className={
            scope.level === 'global'
              ? 'hidden'
              : 'mt-3 flex items-center gap-2 rounded-md border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn-soft-fg)]'
          }
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          {/* Not a live region: the editor announces the scope once its data has loaded. */}
          <span data-testid="scope-banner-live">
            {bannerText}
          </span>
        </div>
        {readOnly ? (
          <p className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('productEditor.scope.readOnly')}
          </p>
        ) : null}
      </section>
      {/* Outside the sticky bar (final design review): a long "missing here" list would hold a
          permanent slice of a laptop viewport; the selects and the scope banner stay sticky. */}
      {completeness ? <div className="-mt-2 mb-4 px-3 text-sm">{completeness}</div> : null}
    </>
  );
}

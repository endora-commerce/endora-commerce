import type { ReactNode } from 'react';
import { Badge, Input, Label } from '@endora-commerce/admin-kit/ui';
import { contentLanguageName, type ContentLanguageOffer } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';

/**
 * One name input per content language the sales channels offer (issue #1507,
 * UX audit CAT-05; architect ruling Q3): the category editor and the create
 * form used to offer exactly `en-US` and `pl-PL`, whatever the shop sells in.
 *
 * - Every editable language gets a field, all visible at once: a name is one
 *   short line, so a tab per language would hide which translations are
 *   missing behind a click each (Prägnanz; Hick — one glance, no switching).
 * - A stored name in a language no channel offers stays on screen, read-only
 *   (focusable, so it can still be read and copied) and flagged with a badge
 *   and a hint — text and badge, never colour alone (WCAG 1.4.1).
 * - While the channels load, when they cannot be read, or when none offers a
 *   language, the polite status line below says so; the fields fall back to
 *   the stored languages plus the admin's own (`offerContentLanguages`).
 */
export function LocalizedNameFields({
  idBase,
  offer,
  values,
  onChange,
}: {
  /** The ids' common prefix; unique on the page. */
  idBase: string;
  offer: ContentLanguageOffer;
  values: Record<string, string>;
  onChange: (language: string, value: string) => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const { language: adminLanguage } = useTranslationContext();
  const label = (code: string): string =>
    t('categories.field.nameIn', { language: contentLanguageName(code, adminLanguage) });
  const loading = offer.degraded === 'loading';

  return (
    <div className="space-y-2" aria-busy={loading || undefined}>
      {/* Mounted before it has text, so the message is announced when it arrives (SC 4.1.3). */}
      <p role="status" className="text-xs text-muted-foreground">
        {offer.degraded === null ? '' : t(`contentLanguages.${offer.degraded}`)}
      </p>
      {loading ? null : (
        <div className="grid gap-4 md:grid-cols-2">
          {offer.editable.map((code) => (
            <div key={code} className="space-y-2">
              <Label htmlFor={`${idBase}-name-${code}`}>{label(code)}</Label>
              <Input
                id={`${idBase}-name-${code}`}
                lang={code}
                value={values[code] ?? ''}
                onChange={(e): void => onChange(code, e.target.value)}
              />
            </div>
          ))}
          {offer.outside.map((code) => (
            <div key={code} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`${idBase}-name-${code}`}>{label(code)}</Label>
                <Badge variant="warning">{t('contentLanguages.outside.badge')}</Badge>
              </div>
              <Input
                id={`${idBase}-name-${code}`}
                lang={code}
                value={values[code] ?? ''}
                readOnly
                aria-describedby={`${idBase}-name-${code}-hint`}
                className="bg-muted text-muted-foreground"
              />
              <p id={`${idBase}-name-${code}-hint`} className="text-xs text-muted-foreground">
                {t('contentLanguages.outside.hint')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

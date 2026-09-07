import type { ReactNode } from 'react';
import { Button } from '../../ui/button.js';
import { useTranslation } from '../../i18n/useTranslation.js';

/**
 * A tab strip over content language codes: the caller passes the codes and the
 * active one in, and gets the chosen one back.
 *
 * **Published by feature 091, P8.** The component sat under `cms`' admin
 * directory and was rendered by `blog`'s two editors as well as by `cms`' own
 * three — four `cross-module-imports` keys over a strip that holds nothing of
 * `cms`: `admin-component-contribution.md` Z1 question 1 (value in, value back)
 * settles that the **consumer** decides it appears, which is a published
 * component and not a zone contribution.
 *
 * **Its copy is `core`'s, not `cms`'** (R-1, `admin-kit-surface.md` R6). A
 * translation namespace is module knowledge: the bundle behind one ships in a
 * module package the kit does not and may not depend on, it is resolved at
 * runtime by string, and a key the namespace does not carry renders
 * `core.<key>` at the operator rather than failing to compile. Both of this
 * component's keys had no other reader anywhere in the tree, so they moved to
 * `core` under `contentLanguageTabs.*` rather than being copied.
 */
export interface ContentLanguageTabsProps {
  /** The content language codes to offer, in the order they should read. */
  languages: string[];
  /** The code currently selected, or `null` while nothing is. */
  activeLanguage: string | null;
  /** The caller commits the chosen code. */
  onChange: (language: string) => void;
}

export function ContentLanguageTabs({
  languages,
  activeLanguage,
  onChange,
}: ContentLanguageTabsProps): ReactNode {
  const t = useTranslation('core');

  if (languages.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('contentLanguageTabs.empty')}</p>;
  }

  return (
    <div
      className="flex flex-wrap gap-2"
      role="tablist"
      aria-label={t('contentLanguageTabs.ariaLabel')}
    >
      {languages.map((language) => {
        const active = language === activeLanguage;
        return (
          <Button
            key={language}
            type="button"
            variant={active ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(language)}
            role="tab"
            aria-selected={active}
          >
            {language}
          </Button>
        );
      })}
    </div>
  );
}

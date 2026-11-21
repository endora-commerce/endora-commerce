import { useId, useMemo, type ReactNode } from 'react';
import { Languages } from 'lucide-react';
import { Tabs, type TabItem } from '../../ui/tabs.js';
import { EmptyState } from '../../ui/empty-state.js';
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
 *
 * **It is the kit's `Tabs`** (issue #1445, UX audit 2026-11-17, DS-12): one tab
 * in the tab order (roving `tabindex`), ←/→ select and wrap, Home/End jump to
 * the ends, and the look of every other strip in the admin (Jakob, Similarity).
 * The screen owns the panel, because the strip sits in a card header or a
 * canvas bar and the fields it switches sit elsewhere: pass `idBase` and wrap
 * the per-language content in `<TabPanel idBase={idBase} value={activeLanguage}>`,
 * and every tab names that panel (`aria-controls`). Without `idBase` the strip
 * is page state over the screen — a form builder's language above its own
 * tabs — and names no panel, rather than one that is not there.
 *
 * **No language to offer** (issue #1448, DS-15): the kit's `EmptyState` with
 * the reason, never a bare grey sentence — an empty strip would leave the
 * operator editing content in no language without saying why.
 */
export interface ContentLanguageTabsProps {
  /** The content language codes to offer, in the order they should read. */
  languages: string[];
  /** The code currently selected, or `null` while nothing is. */
  activeLanguage: string | null;
  /** The caller commits the chosen code. */
  onChange: (language: string) => void;
  /**
   * The ids' common prefix (see `Tabs`): the screen renders the per-language
   * content in `<TabPanel idBase={idBase} value={activeLanguage}>`, and every
   * tab names it. Omit it only for a strip that switches page state spread over
   * the screen, with no one panel to name. Unique on the page.
   */
  idBase?: string | undefined;
}

export function ContentLanguageTabs({
  languages,
  activeLanguage,
  onChange,
  idBase,
}: ContentLanguageTabsProps): ReactNode {
  const t = useTranslation('core');
  const generatedId = useId();
  const items = useMemo<TabItem[]>(
    () => languages.map((language) => ({ value: language, label: language })),
    [languages],
  );

  if (languages.length === 0) {
    return (
      <EmptyState
        icon={<Languages size={20} />}
        title={t('contentLanguageTabs.empty')}
        description={t('contentLanguageTabs.emptyHint')}
      />
    );
  }

  return (
    <Tabs
      items={items}
      // `Tabs` keeps its first tab in the tab order while nothing is selected.
      value={activeLanguage ?? ''}
      onValueChange={onChange}
      idBase={idBase ?? `content-language-${generatedId}`}
      controlsPanel={idBase !== undefined}
      aria-label={t('contentLanguageTabs.ariaLabel')}
    />
  );
}

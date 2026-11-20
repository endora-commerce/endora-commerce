'use client';

import { useId, useMemo, useState, type ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { useGetPuck, type ComponentData, type PuckApi } from '@puckeditor/core';
import {
  SECTION_PRESETS,
  presetBlockNames,
  type SectionPreset,
} from '@endora-commerce/cms-components/editor/section-presets';
import { isTopLevelParent } from '@endora-commerce/page-builder-core';
import { usePageBuilderPuck } from '@endora-commerce/page-builder-core/editor';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

const ROOT_ZONE = 'root:default-zone';

/** The container of Sections (T158): a preset Section may go into its slot. */
const SECTION_GROUP = 'cms.SectionGroup';

/**
 * Where a preset goes: after the top-level section holding the selected block,
 * or at the end of the page when nothing is selected. A preset is a section,
 * so it is inserted at the top level (section settings apply there only,
 * research R-8) — or, when the selected block stands in a Section of a
 * top-level Section group, into that group after its Section (T158), the
 * other place a Section may stand.
 */
function insertionPoint(puck: PuckApi): { zone: string; index: number } {
  let id = puck.selectedItem?.props.id as string | undefined;
  let child: string | undefined;
  while (id !== undefined) {
    const parent = puck.getParentById(id);
    if (isTopLevelParent(parent ?? null)) break;
    child = id;
    id = parent?.props.id as string | undefined;
  }
  if (id !== undefined && child !== undefined && puck.getItemById(id)?.type === SECTION_GROUP) {
    const inGroup = puck.getSelectorForId(child);
    if (inGroup?.zone === `${id}:content`) return { zone: inGroup.zone, index: inGroup.index + 1 };
  }
  const selector = id === undefined ? undefined : puck.getSelectorForId(id);
  if (selector && selector.zone === ROOT_ZONE) return { zone: ROOT_ZONE, index: selector.index + 1 };
  return { zone: ROOT_ZONE, index: puck.appState.data.content.length };
}

/**
 * The block drawer's "Section presets" list (`specs/163-page-builder-marketing-pages/`
 * FR-042, research R-22): six ready-made sections, inserted with Puck's
 * `insert` action at the top level and then filled with the preset's tree, so
 * the page around them is kept and one undo removes the whole section. A
 * preset whose blocks this editor does not offer (another context) is not
 * listed; with none left, the panel is not rendered.
 */
export function SectionPresetsPanel(): ReactElement | null {
  const t = useTranslation('cms');
  const getPuck = useGetPuck();
  const components = usePageBuilderPuck((s) => s.config.components);
  const [status, setStatus] = useState('');
  const headingId = useId();
  const hintId = useId();

  const available = useMemo(
    () =>
      SECTION_PRESETS.filter((preset) =>
        presetBlockNames(preset.build(() => '')).every((name) => name in components),
      ),
    [components],
  );
  if (available.length === 0) return null;

  const insert = (preset: SectionPreset): void => {
    const puck = getPuck();
    const tree: ComponentData = preset.build((key) => t(key));
    const { zone: destinationZone, index: destinationIndex } = insertionPoint(puck);
    puck.dispatch({
      type: 'insert',
      componentType: tree.type,
      destinationIndex,
      destinationZone,
      id: tree.props.id as string,
      recordHistory: false,
    });
    puck.dispatch({
      type: 'replace',
      destinationIndex,
      destinationZone,
      data: tree,
      ui: { itemSelector: { index: destinationIndex, zone: destinationZone } },
    });
    setStatus(t('presets.panel.inserted', { name: t(preset.labelKey) }));
  };

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      aria-describedby={hintId}
      // No box around the list (issue #1437, DS-03): the preset buttons are bordered like the
      // drawer's own block items, and one rule sets the presets off from the blocks below.
      className="mx-1 mb-2 border-b pb-2"
    >
      <h3 id={headingId} className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('presets.panel.title')}
      </h3>
      <p id={hintId} className="mb-2 px-1 text-xs text-muted-foreground">
        {t('presets.panel.hint')}
      </p>
      <ul className="flex flex-col gap-1">
        {available.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              className="flex min-h-11 w-full items-start gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(): void => insert(preset)}
            >
              <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex flex-col">
                <span className="font-medium" data-preset-label="">
                  {t(preset.labelKey)}
                </span>
                <span className="text-xs text-muted-foreground">{t(preset.descriptionKey)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}

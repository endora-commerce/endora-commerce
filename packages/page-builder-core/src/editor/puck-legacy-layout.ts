import { legacySideBarPlugin, type DndConfig, type Plugin, type Viewports } from '@puckeditor/core';

/**
 * The editor layout every builder host (CMS pages, e-mail templates, invoice
 * templates) was designed and tested against, pinned across the move from
 * `@measured/puck` 0.20 to `@puckeditor/core` 0.23.
 *
 * None of the three changes below touches stored data; each reshapes the editor
 * chrome by changing a default, so the host has to opt back out explicitly:
 *
 *   * **0.21 Plugin Rail.** The left side bar became an icon rail with one panel
 *     at a time. `legacySideBarPlugin` restores the stacked Components + Outline
 *     side bar, which the drawer search and the custom outline are laid out for.
 *   * **0.21 full-width viewport.** A fourth default viewport, `100%`, was added
 *     and becomes the initial one. The CMS host passes its own breakpoints; the
 *     e-mail and invoice hosts relied on the defaults, so they pin the 0.20 set.
 *   * **0.23 drag-and-drop.** The default `auto` behaviour shows an insertion
 *     line for inserts and cross-slot moves; `fluid` is the 0.20 behaviour, the
 *     one the `[data-dnd-placeholder]` styling in the admin theme assumes.
 */
export const PUCK_LEGACY_VIEWPORTS: Viewports = [
  { width: 360, height: 'auto', icon: 'Smartphone', label: 'Small' },
  { width: 768, height: 'auto', icon: 'Tablet', label: 'Medium' },
  { width: 1280, height: 'auto', icon: 'Monitor', label: 'Large' },
];

export const PUCK_LEGACY_DND: DndConfig = { behavior: 'fluid' };

/** One instance for the process — a new plugin object per render remounts the side bar. */
const LEGACY_SIDE_BAR: Plugin = legacySideBarPlugin();

/** The host's plugins behind the 0.20 side bar. */
export function withPuckLegacySideBar(plugins: readonly Plugin[]): Plugin[] {
  return [LEGACY_SIDE_BAR, ...plugins];
}

import { describe, expect, it } from 'vitest';
import type { Plugin } from '@puckeditor/core';
import {
  PUCK_LEGACY_DND,
  PUCK_LEGACY_VIEWPORTS,
  withPuckLegacySideBar,
} from './puck-legacy-layout.js';

/**
 * The page, e-mail and invoice builders were designed against `@measured/puck`
 * 0.20. `@puckeditor/core` 0.21–0.23 changed three defaults that reshape the
 * editor without any data change; these pins hold every host to the 0.20 layout.
 */
describe('puck legacy layout', () => {
  it('pins the three viewports 0.20 shipped by default, without the 0.21 full-width one', () => {
    expect(PUCK_LEGACY_VIEWPORTS).toEqual([
      { width: 360, height: 'auto', icon: 'Smartphone', label: 'Small' },
      { width: 768, height: 'auto', icon: 'Tablet', label: 'Medium' },
      { width: 1280, height: 'auto', icon: 'Monitor', label: 'Large' },
    ]);
  });

  it('keeps the 0.20 fluid canvas drag-and-drop rather than the 0.23 insertion line', () => {
    expect(PUCK_LEGACY_DND).toEqual({ behavior: 'fluid' });
  });

  it('puts the legacy side bar first and keeps the host plugins in order', () => {
    const outline: Plugin = { overrides: {} };
    const fields: Plugin = { overrides: {} };
    const plugins = withPuckLegacySideBar([outline, fields]);

    expect(plugins).toHaveLength(3);
    expect(plugins[0]?.name).toBe('legacy-side-bar');
    expect(typeof plugins[0]?.render).toBe('function');
    expect(plugins[1]).toBe(outline);
    expect(plugins[2]).toBe(fields);
  });

  it('returns the same side bar plugin instance on every call so Puck never remounts it', () => {
    expect(withPuckLegacySideBar([])[0]).toBe(withPuckLegacySideBar([])[0]);
  });
});

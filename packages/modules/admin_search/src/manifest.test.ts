import { describe, expect, it } from 'vitest';
import { manifest } from './manifest.js';
import en from '../i18n/en.json' with { type: 'json' };
import pl from '../i18n/pl.json' with { type: 'json' };

// Issue #1335 (comment) — projects and tasks register admin-search providers,
// so the module's own descriptions name them beside the older record types.
describe('admin_search manifest — the searchable record types', () => {
  it('names projects and tasks in the module description', () => {
    expect(manifest.description).toMatch(/projects/);
    expect(manifest.description).toMatch(/tasks/);
  });

  it('names projects and tasks in the palette action description, in both languages', () => {
    const key = 'actions.openGlobalSearch.description';
    expect((en as Record<string, string>)[key]).toMatch(/projects/);
    expect((en as Record<string, string>)[key]).toMatch(/tasks/);
    expect((pl as Record<string, string>)[key]).toMatch(/projektów/);
    expect((pl as Record<string, string>)[key]).toMatch(/zadań/);
  });
});

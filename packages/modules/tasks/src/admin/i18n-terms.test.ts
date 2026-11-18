import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * One Polish word per concept on the Tasks screens (issue #508, owner ruling
 * 2026-10-29): a tag is an **etykieta**, as in CRM, whose bundle shares the
 * tag components; a draft is a **szkic**, as in the catalog. The review found
 * *Tagi* beside *Etykiety* and *Wersja robocza* beside *szkice* in one bundle.
 */

const pl = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../i18n/pl.json'), 'utf8')) as Record<string, string>;

describe('the Polish tasks bundle uses one term per concept (#508)', () => {
  it('calls a tag an etykieta, never a tag', () => {
    const offending = Object.entries(pl).filter(([, value]) => /\btag(i|u|ów|iem|ach|ami|om)?\b/i.test(value));
    expect(offending).toEqual([]);
    expect(pl['field.tags']).toBe('Etykiety');
  });

  it('calls the workflow przebieg zadań, never proces (#512)', () => {
    const offending = Object.entries(pl).filter(([, value]) => /\bproces\p{L}*/iu.test(value));
    expect(offending).toEqual([]);
    expect(pl['workflow.title']).toBe('Statusy i przebieg zadań');
  });

  it('names the assignees in the plural where a Task can have several (#512)', () => {
    const en = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../i18n/en.json'), 'utf8')) as Record<string, string>;
    for (const key of ['list.col.assignee', 'list.filter.assignee']) {
      expect(en[key], key).toBe(en['field.assignee']);
      expect(pl[key], key).toBe(pl['field.assignee']);
    }
  });

  it('calls a draft a szkic, never a wersja robocza', () => {
    const offending = Object.entries(pl).filter(([, value]) => /\bwersj\p{L}* robocz\p{L}*/iu.test(value));
    expect(offending).toEqual([]);
    expect(pl['detail.draftBadge']).toBe('Szkic');
  });
});

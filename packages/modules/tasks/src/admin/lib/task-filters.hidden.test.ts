import { describe, expect, it } from 'vitest';
import { hiddenFilterCount } from './task-filters.js';

/** The count on the filter bar's *More filters* disclosure (issue #512). */
describe('hiddenFilterCount', () => {
  it('counts nothing for the filters the bar always shows', () => {
    expect(hiddenFilterCount(new URLSearchParams('q=rack&status=done&assignee=me&dueFrom=2026-11-01&dueTo=2026-11-30&overdue=true'))).toBe(0);
  });

  it('counts each folded filter once, however many values it carries', () => {
    const params = new URLSearchParams(
      'statusCategory=done&statusCategory=cancelled&creator=me&priority=high&priority=low&tagId=a&isSubtask=true&draft=true&private=true',
    );
    expect(hiddenFilterCount(params)).toBe(7);
  });

  it('counts the hierarchy once whichever parameter carries it', () => {
    expect(hiddenFilterCount(new URLSearchParams('hasSubtasks=true'))).toBe(1);
  });

  it('leaves out what the screen implies and so does not offer', () => {
    expect(hiddenFilterCount(new URLSearchParams('statusCategory=open&draft=false'), { statusCategory: true, draft: true })).toBe(0);
  });

  it('counts each custom-field filter', () => {
    expect(hiddenFilterCount(new URLSearchParams('cf.region.contains=north&cf.size.min=3'))).toBe(2);
  });
});

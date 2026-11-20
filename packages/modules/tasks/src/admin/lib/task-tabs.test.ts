import { describe, expect, it } from 'vitest';
import { DEFAULT_TASK_TAB, searchForTaskTab, taskTabFromSearch } from './task-tabs.js';

describe('the Task screen tabs in the address (issue #1524)', () => {
  it('reads the tab the address names, and the default for none or an unknown one', () => {
    expect(taskTabFromSearch(new URLSearchParams('tab=history'))).toBe('history');
    expect(taskTabFromSearch(new URLSearchParams(''))).toBe(DEFAULT_TASK_TAB);
    expect(taskTabFromSearch(new URLSearchParams('tab=board'))).toBe(DEFAULT_TASK_TAB);
  });

  it('keeps every other parameter, and drops the parameter for the default tab', () => {
    const search = new URLSearchParams('returnTo=%2Forders%2F1&tab=history');
    expect(searchForTaskTab(search, 'attachments').toString()).toBe('returnTo=%2Forders%2F1&tab=attachments');
    expect(searchForTaskTab(search, DEFAULT_TASK_TAB).toString()).toBe('returnTo=%2Forders%2F1');
  });
});

import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_SECTION_TABS,
  workflowSection,
  workflowSectionPath,
} from './workflow-sections.js';

describe('workflowSection (issue #1559)', () => {
  it('opens the tab whose path the pathname ends with', () => {
    expect(workflowSection('/crm/workflow')).toBe('statuses');
    expect(workflowSection('/crm/workflow/order-sync')).toBe('orderSync');
    expect(workflowSection('/crm/workflow/value/')).toBe('value');
    expect(workflowSection('/crm/workflow/board-card')).toBe('boardCard');
  });

  it('falls back to Statuses & moves for any other path', () => {
    expect(workflowSection('/')).toBe('statuses');
    expect(workflowSection('/crm/workflow/unknown')).toBe('statuses');
  });

  it('round-trips every tab through its path', () => {
    for (const tab of WORKFLOW_SECTION_TABS) {
      expect(workflowSection(workflowSectionPath(tab.section))).toBe(tab.section);
    }
  });
});

import type { Field, Fields } from '@measured/puck';
import { EDITOR_NAME_FIELD_KEY } from '../types/editor-chrome.js';
import { isResponsiveField } from '../types/responsive.js';
import type { SettingsTab } from './settings-tab-store.js';

export function fieldTabForName(fieldName: string, field: Field | undefined): SettingsTab {
  if (fieldName === EDITOR_NAME_FIELD_KEY || fieldName === 'hideOn') return 'general';
  if (field && isResponsiveField(field)) return 'responsive';
  return 'general';
}

export function componentHasResponsiveFields(fields: Fields | undefined): boolean {
  if (!fields) return false;
  return Object.entries(fields).some(([name, field]) => fieldTabForName(name, field) === 'responsive');
}

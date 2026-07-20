'use client';

import type { GaTriggerAction } from '@b2b/contracts';
import { getGaConfig, trackGaEvent } from './gtag';

type Primitive = string | number | boolean;

/**
 * Custom-event collector (feature 049, US3). For a triggered storefront action,
 * emits every enabled custom event bound to that action, including only the
 * admin-selected fields (absent fields are omitted, never blocking the event —
 * FR-021). File values are never passed in by callers (FR-018).
 */
export function emitActionEvents(
  action: GaTriggerAction,
  available: Record<string, Primitive | null | undefined>,
): void {
  const config = getGaConfig();
  if (!config?.enabled) return;
  for (const ce of config.customEvents) {
    if (ce.triggerAction !== action) continue;
    trackGaEvent(ce.eventName, pickFields(ce.fields, available));
  }
}

/**
 * Handles a `button_click_by_id` custom event: matches the clicked element's id
 * against configured buttons, captures the page + the element's `data-*`
 * attributes, and emits with the selected fields.
 */
export function emitButtonClick(el: HTMLElement, page: string): void {
  const config = getGaConfig();
  if (!config?.enabled) return;
  const id = el.id;
  const dataAttrs: Record<string, string> = { page };
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-')) dataAttrs[attr.name.slice('data-'.length)] = attr.value;
  }
  for (const ce of config.customEvents) {
    if (ce.triggerAction !== 'button_click_by_id') continue;
    if (ce.buttonId && ce.buttonId !== id) continue;
    trackGaEvent(ce.eventName, pickFields(ce.fields, dataAttrs));
  }
}

function pickFields(
  fields: ReadonlyArray<{ fieldKey: string; payloadKey: string }>,
  available: Record<string, Primitive | null | undefined>,
): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  for (const f of fields) {
    const value = available[f.fieldKey];
    if (value !== null && value !== undefined) out[f.payloadKey] = value;
  }
  return out;
}

import type { ComponentConfig, Fields } from '@measured/puck';
import { createEditorNameField } from '../fields/editor-name-field.js';
import type { ComponentContextMeta } from '../define-component.js';
import { EDITOR_NAME_FIELD_KEY } from '../types/editor-chrome.js';
import { isResponsiveField } from '../types/responsive.js';

/** Stable field instances — must not be recreated (breaks input focus). */
const EDITOR_NAME_FIELD = createEditorNameField();

function orderFields(fields: Fields): Fields {
  const ordered: Fields = {};
  const keys = Object.keys(fields);

  const generalKeys = keys.filter((key) => key !== EDITOR_NAME_FIELD_KEY && key !== 'hideOn' && !isResponsiveField(fields[key]!));
  const responsiveKeys = keys.filter((key) => isResponsiveField(fields[key]!));

  if (EDITOR_NAME_FIELD_KEY in fields) {
    ordered[EDITOR_NAME_FIELD_KEY] = fields[EDITOR_NAME_FIELD_KEY]!;
  }

  if ('hideOn' in fields) {
    ordered.hideOn = fields.hideOn!;
  }

  for (const key of generalKeys) {
    ordered[key] = fields[key]!;
  }

  for (const key of responsiveKeys) {
    ordered[key] = fields[key]!;
  }

  return ordered;
}

/**
 * Adds editor chrome (Name field) and orders fields for the tabbed sidebar.
 */
export function enhancePageBuilderComponent(
  config: ComponentConfig & ComponentContextMeta,
): ComponentConfig & ComponentContextMeta {
  const baseFields = config.fields ?? {};
  const mergedFields = {
    ...(EDITOR_NAME_FIELD_KEY in baseFields ? {} : { [EDITOR_NAME_FIELD_KEY]: EDITOR_NAME_FIELD }),
    ...baseFields,
  } as Fields;

  const orderedFields = orderFields(mergedFields);
  const previousResolveFields = config.resolveFields;

  const next: ComponentConfig & ComponentContextMeta = {
    ...config,
    fields: orderedFields,
    defaultProps: {
      ...(config.defaultProps ?? {}),
    },
  };

  if (previousResolveFields) {
    next.resolveFields = (data, params) => {
      const resolved = previousResolveFields(data, params);
      const merged = {
        ...(EDITOR_NAME_FIELD_KEY in resolved ? {} : { [EDITOR_NAME_FIELD_KEY]: EDITOR_NAME_FIELD }),
        ...resolved,
      } as Fields;
      return orderFields(merged);
    };
  }

  return next;
}

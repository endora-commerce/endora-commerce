// The editor config of a block the descriptor declares (plan D8, FR-014;
// `contracts/block-renderers.md` §4).

import type { ComponentConfig, Field } from '@puckeditor/core';
import type { ReactNode } from 'react';

import { fieldsFromDescriptor, type DescriptorFieldSource } from './fields-from-descriptor.js';
import type { PageBuilderBlockEditorConfig } from './types.js';

/** The part of a served descriptor entry an editor config is built from. */
export interface DescriptorBlockSource extends DescriptorFieldSource {
  readonly defaultProps?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A Puck component config for one declared block.
 *
 * **What comes from where is the rule, not a default.** The field *set* and the
 * default props are the declaration's — the manifest is what the palette, the
 * storefront and the e-mail renderer agree on. The `render` is the editor's.
 * A contributed `fields` entry replaces the derived editor for a key the
 * declaration carries (a picker in place of a text input) and is ignored for a
 * key it does not. Label and category are not here at all: the editor resolves
 * them from the descriptor, in the declaring module's i18n scope.
 *
 * With a neutral preview as `editor.render` this is the editor of a block
 * nothing contributed a renderer for — which is what keeps an overlay module's
 * block, and a block whose module the admin build is one version behind,
 * insertable and editable.
 */
export function editorConfigFromDescriptor(
  entry: DescriptorBlockSource,
  editor: PageBuilderBlockEditorConfig,
): ComponentConfig {
  const derived = fieldsFromDescriptor(entry) as Record<string, Field>;
  const overrides = (editor.fields ?? {}) as Record<string, Field>;
  const fields: Record<string, Field> = {};
  for (const [key, field] of Object.entries(derived)) {
    fields[key] = Object.hasOwn(overrides, key) ? (overrides[key] as Field) : field;
  }
  const { fields: _ignoredFields, ...rest } = editor as Record<string, unknown>;
  delete rest['label'];
  delete rest['defaultProps'];
  return {
    ...rest,
    fields,
    defaultProps: { ...(entry.defaultProps ?? {}) },
  } as unknown as ComponentConfig;
}

/**
 * A preview that draws nothing of the block and says so: its name, and one
 * sentence the caller translated.
 *
 * Inline styles on purpose. The CMS canvas is an iframe carrying the
 * storefront's stylesheets and the e-mail canvas carries none, so a class name
 * here would be styled in one editor and not in the other.
 */
export function neutralBlockPreview(
  blockName: string,
  sentence: string,
): (props: Record<string, unknown>) => ReactNode {
  return function NeutralBlockPreview(): ReactNode {
    return (
      <div
        role="note"
        style={{
          border: '1px dashed #94a3b8',
          borderRadius: 6,
          background: '#f8fafc',
          color: '#334155',
          padding: 12,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          lineHeight: 1.4,
        }}
      >
        <code style={{ fontWeight: 600 }}>{blockName}</code>
        <div style={{ marginTop: 4 }}>{sentence}</div>
      </div>
    );
  };
}

import type { ComponentConfig } from '@measured/puck';
import type { ReactNode } from 'react';
import { createHideOnField } from '../fields/hide-on-field.js';
import { RESPONSIVE_HIDE_ON_CLASS, hideOnDataAttrs } from '../render/responsive-styles.js';
import type { HideOnProps } from '../types/hide-on.js';

const HIDE_ON_FIELD = createHideOnField();

/**
 * Adds a "Hide on" checkbox section and render-time hiding per screen size.
 * In the editor, hidden breakpoints are grayed out instead of removed.
 */
export function withHideOn<Props extends HideOnProps>(
  config: ComponentConfig<{ props: Props }>,
): ComponentConfig<{ props: Props }> {
  const originalRender = config.render;
  const { hideOn: _hideOnField, ...restFields } = config.fields ?? {};

  return {
    ...config,
    fields: {
      hideOn: HIDE_ON_FIELD,
      ...restFields,
    } as ComponentConfig<{ props: Props }>['fields'],
    defaultProps: {
      ...(config.defaultProps ?? {}),
    } as Props,
    render: (props) => {
      const body = originalRender ? originalRender(props) : null;
      const isEditing = props.puck?.isEditing === true;
      return (
        <div
          className={RESPONSIVE_HIDE_ON_CLASS}
          {...hideOnDataAttrs(props.hideOn)}
          data-pb-editing={isEditing ? '1' : '0'}
        >
          {body as ReactNode}
        </div>
      );
    },
  } as ComponentConfig<{ props: Props }>;
}

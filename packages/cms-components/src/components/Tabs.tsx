'use client';

import { useState, type KeyboardEvent } from 'react';
import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { withHideOn } from '@endora-commerce/page-builder-core';
import type { TabsProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { sanitizeHtml } from '../utils/sanitize-html.js';

const TabsRender: PuckComponent<TabsProps> = (props) => {
  const {
    items = [],
    defaultTab = 0,
    variant = 'underline',
    align = 'start',
    puck,
    ...box
  } = props;
  const editing = puck?.isEditing === true;
  const [active, setActive] = useState(Math.min(defaultTab, Math.max(0, items.length - 1)));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    setActive((prev) => (prev + dir + items.length) % items.length);
  };

  if (items.length === 0) {
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' as const } : {})}>
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Add tabs in the sidebar</p>
      </BoxStyled>
    );
  }

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' as const } : {})}>
      <div className={`cmsc-pb-tabs cmsc-pb-tabs--${variant} cmsc-pb-tabs--align-${align}`}>
        <div className="cmsc-pb-tabs__list" role="tablist" onKeyDown={onKeyDown}>
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              id={`cmsc-tab-${i}`}
              aria-selected={active === i}
              aria-controls={`cmsc-tabpanel-${i}`}
              className={`cmsc-pb-tabs__tab${active === i ? ' cmsc-pb-tabs__tab--active' : ''}`}
              onClick={() => setActive(i)}
            >
              {item.label || `Tab ${i + 1}`}
            </button>
          ))}
        </div>
        {items.map((item, i) => (
          <div
            key={i}
            role="tabpanel"
            id={`cmsc-tabpanel-${i}`}
            aria-labelledby={`cmsc-tab-${i}`}
            hidden={active !== i}
            className="cmsc-pb-tabs__panel"
          >
            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content ?? '') }} />
          </div>
        ))}
      </div>
    </BoxStyled>
  );
};

const tabsConfig: ComponentConfig<TabsProps> = {
  label: 'Tabs',
  fields: {
    items: {
      type: 'array',
      label: 'Tabs',
      arrayFields: {
        label: { type: 'text', label: 'Label' },
        content: { type: 'textarea', label: 'Content (HTML)' },
      },
      defaultItemProps: { label: 'Tab', content: '<p>Tab content</p>' },
    },
    defaultTab: { type: 'number', label: 'Default tab index', min: 0 },
    variant: {
      type: 'select',
      label: 'Style',
      options: [
        { label: 'Underline', value: 'underline' },
        { label: 'Pills', value: 'pills' },
        { label: 'Boxed', value: 'boxed' },
      ],
    },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Start', value: 'start' },
        { label: 'Center', value: 'center' },
        { label: 'Stretch', value: 'stretch' },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    items: [{ label: 'Tab 1', content: '<p>First tab</p>' }, { label: 'Tab 2', content: '<p>Second tab</p>' }],
    defaultTab: 0,
    variant: 'underline',
    align: 'start',
    ...DEFAULT_BOX_PROPS,
  },
  render: TabsRender,
};

export const Tabs = withHideOn(tabsConfig);

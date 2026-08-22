'use client';

import { useState } from 'react';
import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { withHideOn } from '@endora-commerce/page-builder-core';
import type { AccordionProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { sanitizeHtml } from '../utils/sanitize-html.js';

const AccordionRender: PuckComponent<AccordionProps> = (props) => {
  const {
    items = [],
    allowMultiple = false,
    defaultOpen = [],
    iconPosition = 'end',
    variant = 'default',
    puck,
    ...box
  } = props;
  const editing = puck?.isEditing === true;
  const [open, setOpen] = useState<Set<number>>(() => new Set(defaultOpen));

  const toggle = (index: number): void => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        if (!allowMultiple) next.clear();
        next.add(index);
      }
      return next;
    });
  };

  if (items.length === 0) {
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' as const } : {})}>
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Add accordion items in the sidebar</p>
      </BoxStyled>
    );
  }

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' as const } : {})}>
      <div className={`cmsc-pb-accordion cmsc-pb-accordion--${variant} cmsc-pb-accordion--icon-${iconPosition}`}>
        {items.map((item, i) => {
          const expanded = open.has(i);
          return (
            <div key={i} className="cmsc-pb-accordion__item">
              <button
                type="button"
                className="cmsc-pb-accordion__trigger"
                aria-expanded={expanded}
                onClick={() => toggle(i)}
              >
                {iconPosition === 'start' ? <span className="cmsc-pb-accordion__icon" aria-hidden>{expanded ? '−' : '+'}</span> : null}
                <span className="cmsc-pb-accordion__title">{item.title || `Item ${i + 1}`}</span>
                {iconPosition === 'end' ? <span className="cmsc-pb-accordion__icon" aria-hidden>{expanded ? '−' : '+'}</span> : null}
              </button>
              <div className="cmsc-pb-accordion__panel" hidden={!expanded}>
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content ?? '') }} />
              </div>
            </div>
          );
        })}
      </div>
    </BoxStyled>
  );
};

const accordionConfig: ComponentConfig<AccordionProps> = {
  label: 'Accordion',
  fields: {
    items: {
      type: 'array',
      label: 'Items',
      arrayFields: {
        title: { type: 'text', label: 'Header' },
        content: { type: 'textarea', label: 'Content (HTML)' },
      },
      defaultItemProps: { title: 'Section', content: '<p>Content</p>' },
    },
    allowMultiple: { type: 'radio', label: 'Allow multiple open', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    defaultOpen: { type: 'number', label: 'Default open index', min: 0 },
    iconPosition: {
      type: 'select',
      label: 'Icon position',
      options: [
        { label: 'Start', value: 'start' },
        { label: 'End', value: 'end' },
      ],
    },
    variant: {
      type: 'select',
      label: 'Style',
      options: [
        { label: 'Default', value: 'default' },
        { label: 'Flush', value: 'flush' },
        { label: 'Bordered', value: 'bordered' },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    items: [{ title: 'Section 1', content: '<p>First section</p>' }],
    allowMultiple: false,
    defaultOpen: [],
    iconPosition: 'end',
    variant: 'default',
    ...DEFAULT_BOX_PROPS,
  },
  render: AccordionRender,
};

export const Accordion = withHideOn(accordionConfig);

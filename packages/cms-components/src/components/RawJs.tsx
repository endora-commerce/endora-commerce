'use client';

import { useEffect, useRef } from 'react';
import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { withHideOn } from '@endora-commerce/page-builder-core';
import type { RawJsProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';

const RawJsRender: PuckComponent<RawJsProps> = (props) => {
  const { script, runOnce = true, puck, ...box } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const editing = puck?.isEditing === true;

  useEffect(() => {
    if (editing || !script?.trim() || !containerRef.current) return;
    const el = containerRef.current;
    if (runOnce && el.dataset.pbJsRun === '1') return;

    const node = document.createElement('script');
    node.textContent = script;
    el.appendChild(node);
    if (runOnce) el.dataset.pbJsRun = '1';

    return () => {
      node.remove();
    };
  }, [script, runOnce, editing]);

  return (
    <BoxStyled {...box} className="cmsc-pb-raw-js">
      {editing ? (
        <p className="cmsc:text-sm cmsc:text-[#64748b] cmsc:italic">
          Raw JS — executes on storefront for all visitors (admin-trusted only)
        </p>
      ) : null}
      <div ref={containerRef} data-pb-raw-js="" />
    </BoxStyled>
  );
};

const rawJsConfig: ComponentConfig<RawJsProps> = {
  label: 'Raw JS',
  fields: {
    script: { type: 'textarea', label: 'JavaScript (trusted admin)' },
    runOnce: {
      type: 'radio',
      label: 'Run once',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    script: '',
    runOnce: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: RawJsRender,
};

export const RawJs = withHideOn(rawJsConfig);

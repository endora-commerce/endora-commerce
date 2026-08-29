'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { createColorField, withHideOn } from '@endora-commerce/page-builder-core';
import type { AnnouncementBarProps } from '../schema/component-types.js';

const AnnouncementBarRender: PuckComponent<AnnouncementBarProps> = (props) => {
  const {
    text,
    href = '',
    backgroundColor = '#0f766e',
    textColor = '#ffffff',
  } = props;

  const inner = <span className="cmsc-pb-announcement__text">{text}</span>;

  return (
    <div
      className="cmsc-pb-announcement"
      style={{ backgroundColor, color: textColor }}
      role="status"
    >
      {href ? (
        <a className="cmsc-pb-announcement__link" href={href} style={{ color: textColor }}>
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  );
};

const announcementBarConfig: ComponentConfig<AnnouncementBarProps> = {
  label: 'Announcement bar',
  fields: {
    text: { type: 'text', label: 'Message' },
    href: { type: 'text', label: 'Link URL (optional)' },
    backgroundColor: createColorField({ label: 'Background' }),
    textColor: createColorField({ label: 'Text color' }),
  },
  defaultProps: {
    text: 'Free shipping on orders over €500 — shop now',
    href: '',
    backgroundColor: '#0f766e',
    textColor: '#ffffff',
  },
  render: AnnouncementBarRender,
};

export const AnnouncementBar = withHideOn(announcementBarConfig);

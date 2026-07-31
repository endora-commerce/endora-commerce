'use client';

import type { PuckComponent } from '@measured/puck';
import { useMemo } from 'react';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { RichContentProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import { RICH_CONTENT_PROSE_CLASS, resolveRichContentHtml } from './rich-content-shared.js';

export const RichContentPublishedRender: PuckComponent<RichContentProps> = (props) => {
  const safeHtml = useMemo(() => resolveRichContentHtml(props), [props]);

  if (!safeHtml) {
    const { content: _content, html: _html, puck: _puck, ...box } = props;
    return <BoxStyled {...box}>{null}</BoxStyled>;
  }

  const { content: _content, html: _html, puck: _puck, ...box } = props;

  return (
    <BoxStyled {...box}>
      <div className={RICH_CONTENT_PROSE_CLASS} dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </BoxStyled>
  );
};

export const RichContentEditingPreviewRender: PuckComponent<RichContentProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const safeHtml = useMemo(() => resolveRichContentHtml(props), [props]);
  const { content: _content, html: _html, puck: _puck, ...box } = props;

  return (
    <BoxStyled previewTier={tier} {...box}>
      <div className={RICH_CONTENT_PROSE_CLASS} dangerouslySetInnerHTML={{ __html: safeHtml || '<p></p>' }} />
    </BoxStyled>
  );
};

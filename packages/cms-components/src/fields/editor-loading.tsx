'use client';

import type { ReactElement } from 'react';
import { useFieldText } from '@endora-commerce/page-builder-core';

/** What a rich-text field shows while its editor loads on demand, in the host's words (#1680). */
export function EditorLoading(): ReactElement {
  const text = useFieldText();
  return <p className="cmsc:font-sans cmsc:text-[13px] cmsc:opacity-70">{text('richText.loading')}</p>;
}

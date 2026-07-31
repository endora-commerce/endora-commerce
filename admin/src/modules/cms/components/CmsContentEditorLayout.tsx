import type { ReactNode } from 'react';

/**
 * CMS page/block/template editor shell: settings and language tabs in the
 * first row; page builder spans the full content width in a second row below.
 */
export function CmsContentEditorLayout({
  header,
  settings,
  languageTabs,
  builder,
}: {
  header: ReactNode;
  settings: ReactNode;
  languageTabs: ReactNode;
  builder: ReactNode;
}): ReactNode {
  return (
    <div className="b2b-page b2b-page--wide cms-content-editor space-y-4">
      {header}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">{settings}</div>
      {languageTabs}
      <div className="cms-content-editor__builder">{builder}</div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ProjectHistory } from '../../../components/ProjectHistory.js';
import type { ProjectTabProps } from '../tabs.js';

/**
 * The *Change history* tab (User Story 7, FR-028): everything done to the
 * Project, newest first. Read-only — whoever may see the Project may read it.
 * Read again when the Project on screen changes (its `version`), so a write
 * made elsewhere on the screen is the newest entry here.
 *
 * Every entry is an `h3`; the `h2` here is what they hang from, not drawn: the
 * selected tab already says "Change history".
 */
export function HistoryTab({ project }: ProjectTabProps): ReactNode {
  const t = useTranslation('projects');
  return (
    <>
      <h2 className="sr-only">{t('tabs.changeHistory')}</h2>
      <ProjectHistory project={project} reloadKey={project.version} />
    </>
  );
}

export default HistoryTab;

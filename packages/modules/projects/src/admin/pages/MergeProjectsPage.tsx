import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, Label, PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { ProjectLookup } from '../components/LookupPickers.js';
import { ProjectMergeFlow } from '../merge/ProjectMergeFlow.js';

/**
 * *Merge projects* (`specs/192-organization-merge/` US6, FR-082;
 * `contracts/project-merge.md` §4) — the ⌘K action's screen, for an operator
 * who starts from the task rather than from a Project's page: choose the
 * Project to keep, then the same flow the Project's page opens. On a start the
 * merge's progress opens.
 */
export function MergeProjectsPage(): ReactNode {
  const own = useTranslation('projects');
  const navigate = useNavigate();
  const pickerId = useId();
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [survivor, setSurvivor] = useState<{ id: string; name: string } | null>(null);

  const next = async (): Promise<void> => {
    if (survivorId === null) return;
    let name = '';
    try {
      const project = await projectsApi.getProject(survivorId);
      name = `${project.number} ${project.title}`;
    } catch {
      // The flow names the Project to keep generically; the preview and the start check it.
    }
    setSurvivor({ id: survivorId, name: name.length > 0 ? name : own('merge.flow.theSurvivor') });
  };

  return (
    <>
      <PageHeader
        back={{ label: own('merge.palettePage.back'), to: '/projects' }}
        title={own('merge.palettePage.title')}
        actions={
          <Button asChild variant="outline">
            <Link to="/projects/merges">{own('merge.list.title')}</Link>
          </Button>
        }
      />
      <Card>
        <CardContent>
          {survivor === null ? (
            <div className="grid gap-4 md:max-w-md">
              <p className="text-sm text-muted-foreground">{own('merge.palettePage.intro')}</p>
              <div className="grid gap-1.5">
                <Label htmlFor={pickerId}>{own('merge.palettePage.picker')}</Label>
                <ProjectLookup
                  id={pickerId}
                  ariaLabel={own('merge.palettePage.picker')}
                  value={survivorId}
                  onChange={setSurvivorId}
                  placeholder={own('merge.flow.pickerPlaceholder')}
                  clearable
                />
              </div>
              <div>
                <Button type="button" disabled={survivorId === null} onClick={(): void => void next()}>
                  {own('merge.flow.next')}
                </Button>
              </div>
            </div>
          ) : (
            <ProjectMergeFlow
              survivorId={survivor.id}
              survivorName={survivor.name}
              onCancel={(): void => setSurvivor(null)}
              onStarted={(merge): void => {
                void navigate(`/projects/merges/${merge.id}`);
              }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default MergeProjectsPage;

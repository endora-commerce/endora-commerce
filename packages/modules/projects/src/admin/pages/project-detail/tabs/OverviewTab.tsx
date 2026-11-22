import type { ReactNode } from 'react';
import {
  PROJECT_DESCRIPTION_MAX,
  type ProjectDetail,
  type ProjectMember,
  type UpdateProjectBody,
} from '@endora-commerce/contracts';
import { InlineEdit, ReferenceField, ReferenceText } from '@endora-commerce/admin-kit/components';
import { Input } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../../../api.js';
import {
  VisibilityControl,
  VisibilityEffect,
  visibilityBody,
  type VisibilityValue,
} from '../../../components/VisibilityControl.js';
import { ProjectCustomFields } from '../../../components/ProjectCustomFields.js';
import { calendarDateLabel, errorMessage } from '../../../lib/labels.js';
import { useProjectReferences } from '../../../lib/references.js';
import type { ProjectTabProps } from '../tabs.js';

interface RoleGroup {
  key: string;
  title: string;
  members: ProjectMember[];
}

/**
 * Members grouped by the Project Roles they hold, in the order the Roles first
 * appear, then the Members holding none. A Member with two Roles is in both
 * groups — that is what "by Role" answers.
 */
function groupByRole(members: readonly ProjectMember[], archived: (name: string) => string, noRole: string): RoleGroup[] {
  const groups = new Map<string, RoleGroup>();
  const without: ProjectMember[] = [];
  for (const member of members) {
    if (member.roles.length === 0) without.push(member);
    for (const role of member.roles) {
      const group = groups.get(role.id) ?? {
        key: role.id,
        title: role.archived ? archived(role.name) : role.name,
        members: [],
      };
      group.members.push(member);
      groups.set(role.id, group);
    }
  }
  return [...groups.values(), ...(without.length > 0 ? [{ key: 'none', title: noRole, members: without }] : [])];
}

function valueOf(project: ProjectDetail): VisibilityValue {
  return { visibility: project.visibility, viewers: project.viewers.map((viewer) => ({ ...viewer })) };
}

function sameValue(a: VisibilityValue, b: VisibilityValue): boolean {
  const left = visibilityBody(a);
  const right = visibilityBody(b);
  return (
    left.visibility === right.visibility &&
    left.viewerIds.length === right.viewerIds.length &&
    left.viewerIds.every((id) => right.viewerIds.includes(id))
  );
}

/**
 * One fact of the Project saved where it is shown: one `PATCH` naming that
 * fact and the version on screen. A refusal — `PROJECT_CHANGED` included — is
 * the server's sentence, shown under the field, which keeps the draft.
 */
function useProjectUpdate(
  project: ProjectDetail,
  onChange: (next: ProjectDetail) => void,
): (body: Omit<UpdateProjectBody, 'version'>, fallback: string) => Promise<void> {
  return async (body, fallback): Promise<void> => {
    let next: ProjectDetail;
    try {
      next = await projectsApi.updateProject(project.id, { ...body, version: project.version });
    } catch (failure) {
      throw new Error(errorMessage(failure, fallback));
    }
    onChange(next);
  };
}

/**
 * Who sees the Project (User Story 5), as a fact edited in place: the choice,
 * what it means now and who is listed; a writer's pencil opens the three
 * choices with *Save* and *Cancel* (issue #1525, WORK-03).
 */
function VisibilityFact({ project, onChange }: Pick<ProjectTabProps, 'project' | 'onChange'>): ReactNode {
  const t = useTranslation('projects');
  const update = useProjectUpdate(project, onChange);
  return (
    <InlineEdit<VisibilityValue>
      label={t('visibility.section')}
      group
      canEdit={project.permissions.canWrite}
      display={
        <div className="space-y-1">
          <p>{t(`visibility.option.${project.visibility}`)}</p>
          <VisibilityEffect visibility={project.visibility} />
          {project.viewers.length > 0 ? (
            <ul aria-label={t('visibility.listed.label')} className="space-y-0.5">
              {project.viewers.map((viewer) => (
                <li key={viewer.id} className="[overflow-wrap:anywhere]">
                  {viewer.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      }
      initial={(): VisibilityValue => valueOf(project)}
      unchanged={(draft): boolean => sameValue(draft, valueOf(project))}
      save={(draft): Promise<void> => update(visibilityBody(draft), t('visibility.error'))}
      editor={({ id, labelId, draft, setDraft, busy }): ReactNode => (
        <VisibilityControl id={id} labelledBy={labelId} value={draft} disabled={busy} onChange={setDraft} />
      )}
    />
  );
}

/**
 * The description (User Story 7, FR-026): drawn with its references as chips —
 * a person, an Order, a Quote Request, a Task, a Product — and, for a writer,
 * edited in place in the kit's reference field (`@` a person, `@@` a
 * document, `@@@` a Product; Ctrl/Cmd + Enter saves). A person newly
 * mentioned is told by the server.
 */
function DescriptionFact({ project, onChange }: Pick<ProjectTabProps, 'project' | 'onChange'>): ReactNode {
  const t = useTranslation('projects');
  const update = useProjectUpdate(project, onChange);
  const { kinds, lookups } = useProjectReferences({
    projectId: project.id,
    hasOrganizations: project.organizations.length > 0,
  });
  return (
    <InlineEdit<string>
      label={t('overview.description')}
      canEdit={project.permissions.canWrite}
      display={
        project.description.trim() ? (
          <ReferenceText text={project.description} references={project.references} />
        ) : (
          <span className="text-muted-foreground">{t('overview.noDescription')}</span>
        )
      }
      initial={(): string => project.description}
      unchanged={(draft): boolean => draft === project.description}
      save={(draft): Promise<void> => update({ description: draft }, t('overview.descriptionError'))}
      editor={({ id, draft, setDraft, busy, errorId, submit }): ReactNode => (
        <ReferenceField
          id={id}
          value={draft}
          onValueChange={setDraft}
          kinds={kinds}
          lookups={lookups}
          references={project.references}
          maxLength={PROJECT_DESCRIPTION_MAX}
          disabled={busy}
          rows={5}
          autoFocus
          {...(errorId ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})}
          onSubmitShortcut={submit}
        />
      )}
    />
  );
}

/** The start date, edited in place; a Project always has one, so it cannot be cleared. */
function StartDateFact({ project, onChange }: Pick<ProjectTabProps, 'project' | 'onChange'>): ReactNode {
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  const update = useProjectUpdate(project, onChange);
  return (
    <InlineEdit<string>
      label={t('overview.startOn')}
      canEdit={project.permissions.canWrite}
      display={calendarDateLabel(project.startOn, language)}
      initial={(): string => project.startOn}
      validate={(draft): string | null => (draft === '' ? t('overview.startOnRequired') : null)}
      unchanged={(draft): boolean => draft === project.startOn}
      save={(draft): Promise<void> => update({ startOn: draft }, t('overview.startOnError'))}
      editor={({ id, draft, setDraft, busy, errorId }): ReactNode => (
        <Input
          id={id}
          type="date"
          required
          value={draft}
          disabled={busy}
          aria-invalid={errorId !== undefined}
          aria-describedby={errorId}
          onChange={(event): void => setDraft(event.target.value)}
        />
      )}
    />
  );
}

/**
 * A Project's *Overview* tab (`contracts/admin-surfaces.md` §2): the
 * description, the start date, who sees the Project, the Members by Role and
 * the custom fields (User Story 9) — for somebody who may read their
 * definitions, editable by a writer.
 */
export function OverviewTab({ project, onChange }: ProjectTabProps): ReactNode {
  const t = useTranslation('projects');
  const groups = groupByRole(project.members, (role) => t('overview.archivedRole', { role }), t('overview.noRole'));

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          {/* Each fact edited where it is shown, as on an Opportunity and a Task (issue #1525, WORK-03). */}
          <DescriptionFact project={project} onChange={onChange} />
          <StartDateFact project={project} onChange={onChange} />
          <VisibilityFact project={project} onChange={onChange} />
        </div>
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t('overview.members')}</h3>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('overview.noMembers')}</p>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="space-y-1">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h4>
                <ul className="space-y-0.5 text-sm">
                  {group.members.map((member) => (
                    <li key={member.id} className="[overflow-wrap:anywhere]">
                      <span>{member.adminUser.name}</span>
                      {member.adminUser.active ? null : (
                        <span className="text-muted-foreground"> ({t('overview.inactive')})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      </div>
      <ProjectCustomFields project={project} onChange={onChange} />
    </div>
  );
}

export default OverviewTab;

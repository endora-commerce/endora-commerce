import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  PROJECT_DESCRIPTION_MAX,
  type CreateProjectBody,
  type ProjectRole,
  type ProjectTemplateDetail,
  type ProjectTemplateSummary,
} from '@endora-commerce/contracts';
import { useModulePresence } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
  ColorPicker,
  Input,
  Label,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { ReferenceField, StickyFormActions, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { errorMessage, normaliseAmount, parseDuration } from '../lib/labels.js';
import { useProjectReferences } from '../lib/references.js';
import { stageColorAt } from '../lib/stage-colors.js';
import { StageDot } from '../components/StageDot.js';
import { AdminUserLookup, OrganizationsLookup, type LookupChoice } from '../components/LookupPickers.js';
import { VisibilityControl, visibilityBody, type VisibilityValue } from '../components/VisibilityControl.js';
import { customFieldIssues, NewProjectCustomFields } from '../components/ProjectCustomFields.js';

const LIST_PATH = '/projects';

interface StageRow {
  key: number;
  name: string;
  color: string;
  duration: string;
}

interface MemberRow {
  key: number;
  adminUserId: string | null;
  roleIds: string[];
}

type FieldErrors = Partial<Record<'title' | 'stageName' | 'stageDuration' | 'value' | 'currency' | 'member', string>>;

/**
 * Creating a Project by hand (`specs/163-projects-and-tasks/`, User Story 1;
 * `contracts/admin-surfaces.md` §2, `/projects/new`).
 *
 * **A Template first** (User Story 3): choosing one fills the form from it —
 * the default description, the Template's Roles offered first to each Member —
 * and lists the Stages the Project will get from it, with their workflow,
 * gates, alerts and Stage Tasks (research R-7: copied, never referenced). Those
 * are changed on the Project's *Stages* tab afterwards, so the request names
 * the Template and sends no Stages. Everything typed stays editable; "no
 * Template" brings the Stage list back. Archived Templates are not offered.
 *
 * **Nothing typed is set aside without a question** (issue #452). Choosing a
 * Template while Stages are typed by hand, or while the description is one the
 * operator wrote, asks first in the kit's dialog; *Cancel* leaves the form as
 * it was. The hand-typed Stages and description are kept as a draft, and "no
 * Template" brings both back — the description only while it is still the
 * Template's, so an edit made to it afterwards is never undone.
 *
 * Without a Template a title and at least one Stage are required. The Stages
 * are written here in order — name, colour, planned duration — because
 * `POST /projects` then takes them in its body; the Project starts in the first
 * and the default workflow moves each to the next. Everything else a Stage has
 * is set on the Project's *Stages* tab.
 *
 * An empty Organization list is an **internal** Project, which only
 * administrators who reach every Organization can see; the form says so where
 * the Organizations are chosen. Members are chosen one row at a time, each with
 * the Project Roles they hold — a Role grants no permission.
 *
 * **Who sees it** (User Story 5) is chosen here too — following the module
 * setting unless changed. Organizations and people are found through the
 * module's own lookups, so a role holding only `projects:*` can fill the form.
 *
 * **Custom fields** (User Story 9) close the form: the Project fields an
 * operator defined on `/custom-fields`, drawn by the kit's values panel for a
 * person holding `custom_fields:read`. A refusal of one of them is shown at
 * that field and in the form's error alike.
 */
export function ProjectCreate(): ReactNode {
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const navigate = useNavigate();
  const nextKey = useRef(1);
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Before there is a Project: people who may read Projects, and Tasks — no
  // Orders or Quote Requests, which are those of a Project's Organizations.
  const [organizations, setOrganizations] = useState<LookupChoice[]>([]);
  // Before the Project exists, `@@` offers the Orders and Quote Requests of the
  // Organizations chosen on this form.
  const references = useProjectReferences({
    projectId: null,
    hasOrganizations: organizations.length > 0,
    organizationIds: organizations.map((organization) => organization.id),
  });
  const [visibility, setVisibility] = useState<VisibilityValue>({ visibility: 'inherit', viewers: [] });
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [startOn, setStartOn] = useState('');
  const [stages, setStages] = useState<StageRow[]>(() => [{ key: 0, name: '', color: stageColorAt(0), duration: '0' }]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [roles, setRoles] = useState<ProjectRole[]>([]);
  const [rolesFailed, setRolesFailed] = useState(false);
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [templatesFailed, setTemplatesFailed] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [template, setTemplate] = useState<ProjectTemplateDetail | null>(null);
  const [templateState, setTemplateState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const tasksPresent = useModulePresence().isPresent('tasks');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown> | null>(null);
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  /** The description typed before a Template filled it in — brought back by "no Template". */
  const handDescription = useRef<string | null>(null);

  // The Organization screen's "New project" names its Organization in the
  // address: it starts chosen when the reader reaches it, and is otherwise left
  // out — the lookup answers nothing for one out of reach.
  const [searchParams] = useSearchParams();
  const addressedOrganization = searchParams.get('organizationId');
  useEffect(() => {
    if (!addressedOrganization) return;
    let alive = true;
    void projectsApi.organizationOption(addressedOrganization).then((option) => {
      if (alive && option) {
        setOrganizations((chosen) => (chosen.some((o) => o.id === option.id) ? chosen : [...chosen, option]));
      }
    });
    return (): void => {
      alive = false;
    };
  }, [addressedOrganization]);

  // Every Role, labelled in the reader's language: a Member is offered the
  // active ones, and the ones a chosen Template names — archived since or not.
  useEffect(() => {
    let alive = true;
    projectsApi
      .listRoles()
      .then((loaded) => {
        if (alive) setRoles(loaded);
      })
      .catch(() => {
        if (alive) setRolesFailed(true);
      });
    projectsApi
      .listTemplates({ active: true })
      .then((loaded) => {
        if (alive) setTemplates(loaded);
      })
      .catch(() => {
        if (alive) setTemplatesFailed(true);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  /** The Template's Roles first, then every other active one. */
  const offeredRoles = useMemo<ProjectRole[]>(() => {
    const fromTemplate = (template?.roleIds ?? [])
      .map((roleId) => roles.find((role) => role.id === roleId))
      .filter((role): role is ProjectRole => role !== undefined);
    const chosen = new Set(fromTemplate.map((role) => role.id));
    return [...fromTemplate, ...roles.filter((role) => role.archivedAt === null && !chosen.has(role.id))];
  }, [roles, template]);

  const chooseTemplate = async (id: string): Promise<void> => {
    if (id !== '') {
      // Hidden while a Template is chosen, and not sent: set aside, not lost.
      const setsStagesAside = templateId === '' && stages.some((row) => row.name.trim() !== '');
      const replacesDescription = description.trim() !== '' && description !== (template?.description ?? '');
      if (setsStagesAside || replacesDescription) {
        const name = templates.find((option) => option.id === id)?.name ?? '';
        const agreed = await confirm({
          title: t('create.template.replace.title'),
          message: (
            <div className="space-y-2">
              {setsStagesAside ? <p>{t('create.template.replace.stages', { name })}</p> : null}
              {replacesDescription ? <p>{t('create.template.replace.description', { name })}</p> : null}
              <p>{t('create.template.replace.restore')}</p>
            </div>
          ),
          confirmLabel: t('create.template.replace.confirm'),
        });
        if (!agreed) return;
      }
      if (templateId === '') handDescription.current = description;
    }
    const previous = template;
    setTemplateId(id);
    setTemplate(null);
    if (id === '') {
      setTemplateState('idle');
      // What the Template filled in and nobody changed since goes back to what was typed.
      if (previous && handDescription.current !== null && description === previous.description) {
        setDescription(handDescription.current);
      }
      handDescription.current = null;
      return;
    }
    setTemplateState('loading');
    try {
      const loaded = await projectsApi.getTemplate(id);
      setTemplate(loaded);
      setDescription(loaded.description);
      setTemplateState('idle');
    } catch {
      setTemplateState('failed');
    }
  };

  const key = (): number => nextKey.current++;

  const updateStage = (index: number, patch: Partial<StageRow>): void =>
    setStages((previous) => previous.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const moveStage = (index: number, by: -1 | 1): void =>
    setStages((previous) => {
      const target = index + by;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target] as StageRow, next[index] as StageRow];
      return next;
    });

  const updateMember = (index: number, patch: Partial<MemberRow>): void =>
    setMembers((previous) => previous.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const toggleRole = (index: number, roleId: string, on: boolean): void =>
    setMembers((previous) =>
      previous.map((row, at) =>
        at === index
          ? { ...row, roleIds: on ? [...row.roleIds, roleId] : row.roleIds.filter((id) => id !== roleId) }
          : row,
      ),
    );

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const hasValue = amount.trim() !== '' || currency.trim() !== '';
    const normalisedAmount = hasValue ? normaliseAmount(amount) : null;
    const currencyCode = currency.trim().toUpperCase();
    const durations = stages.map((row) => parseDuration(row.duration));

    const next: FieldErrors = {};
    if (trimmedTitle === '') next.title = t('create.error.title');
    if (!template && stages.some((row) => row.name.trim() === '')) next.stageName = t('create.error.stageName');
    if (!template && durations.some((days) => days === null)) next.stageDuration = t('create.error.stageDuration');
    if (hasValue && normalisedAmount === null) next.value = t('create.error.value');
    if (hasValue && !/^[A-Z]{3}$/.test(currencyCode)) next.currency = t('create.error.currency');
    if (members.some((row) => row.adminUserId === null)) next.member = t('create.error.member');
    setErrors(next);
    if (Object.keys(next).length > 0) {
      if (next.title) titleRef.current?.focus();
      return;
    }

    const body: CreateProjectBody = {
      title: trimmedTitle,
      organizationIds: organizations.map((organization) => organization.id),
      ...visibilityBody(visibility),
      // From a Template the Stages are its own; without one, the ones typed here.
      ...(template
        ? { templateId: template.id }
        : {
            stages: stages.map((row, index) => ({
              name: row.name.trim(),
              color: row.color,
              plannedDurationDays: durations[index] ?? 0,
            })),
          }),
      // From a Template the description is always sent: emptied, it stays empty.
      ...(template || description.trim() ? { description } : {}),
      ...(normalisedAmount ? { value: { amount: normalisedAmount, currency: currencyCode } } : {}),
      ...(startOn ? { startOn } : {}),
      ...(members.length > 0
        ? { members: members.map((row) => ({ adminUserId: row.adminUserId as string, roleIds: row.roleIds })) }
        : {}),
      ...(customFieldValues ? { customFieldValues } : {}),
    };

    setBusy(true);
    setSubmitError(null);
    try {
      const created = await projectsApi.createProject(body);
      void navigate(`/projects/${created.id}`);
    } catch (failure) {
      const issues = customFieldIssues(failure);
      setCustomFieldErrors(issues ?? {});
      // The server's sentence, and what it said about each field — shown here
      // as well as at the fields, which are not on screen for somebody who may
      // not read their definitions.
      setSubmitError([errorMessage(failure, t('create.error.generic')), ...Object.values(issues ?? {})].join(' '));
      setBusy(false);
    }
  };

  const required = (
    <span aria-hidden="true" className="text-destructive">
      {' *'}
    </span>
  );

  const fieldError = (id: string, message: string | undefined): ReactNode =>
    message ? (
      <p id={id} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;

  return (
    <>
      <PageHeader
        title={t('create.title')}
        description={t('create.description')}
        back={{ label: t('create.back'), to: LIST_PATH }}
      />

      <form noValidate onSubmit={(event): void => void submit(event)} className="space-y-4">
        {submitError ? (
          <Alert variant="destructive">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardContent className="space-y-1 pt-6">
            <Label htmlFor="project-create-template">{t('create.template.label')}</Label>
            <Select
              id="project-create-template"
              value={templateId}
              disabled={busy}
              aria-describedby="project-create-template-hint"
              onChange={(event): void => void chooseTemplate(event.target.value)}
            >
              <option value="">{t('create.template.none')}</option>
              {templates.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
            <p id="project-create-template-hint" className="text-xs text-muted-foreground">
              {t('create.template.hint')}
            </p>
            {templatesFailed ? (
              <p role="alert" className="text-xs text-destructive">
                {t('create.template.loadError')}
              </p>
            ) : null}
            {templateState === 'loading' ? (
              <p role="status" className="text-xs text-muted-foreground">
                {t('create.template.loading')}
              </p>
            ) : null}
            {templateState === 'failed' ? (
              <p role="alert" className="text-xs text-destructive">
                {t('create.template.detailError')}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="space-y-1">
              <Label htmlFor="project-create-title">
                {t('field.title')}
                {required}
              </Label>
              <Input
                id="project-create-title"
                ref={titleRef}
                value={title}
                maxLength={200}
                required
                aria-invalid={errors.title !== undefined}
                aria-describedby={errors.title ? 'project-create-title-error' : undefined}
                onChange={(event): void => setTitle(event.target.value)}
              />
              {fieldError('project-create-title-error', errors.title)}
            </div>

            <div className="space-y-1">
              <Label htmlFor="project-create-organizations">{t('field.organizations')}</Label>
              <OrganizationsLookup
                id="project-create-organizations"
                ariaLabel={t('field.organizations')}
                value={organizations}
                onChange={setOrganizations}
                max={50}
                placeholder={t('field.organizationsPlaceholder')}
                removeLabel={(name): string => t('field.organizationsRemove', { name })}
              />
              {organizations.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('create.internalNote')}</p>
              ) : null}
            </div>

            <div className="grid gap-x-4 gap-y-5 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="project-create-amount">{t('field.valueAmount')}</Label>
                <Input
                  id="project-create-amount"
                  inputMode="decimal"
                  value={amount}
                  aria-invalid={errors.value !== undefined}
                  aria-describedby="project-create-value-hint"
                  onChange={(event): void => setAmount(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="project-create-currency">{t('field.valueCurrency')}</Label>
                <Input
                  id="project-create-currency"
                  value={currency}
                  maxLength={3}
                  autoCapitalize="characters"
                  className="uppercase"
                  aria-invalid={errors.currency !== undefined}
                  aria-describedby="project-create-value-hint"
                  onChange={(event): void => setCurrency(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="project-create-start">{t('field.startOn')}</Label>
                <Input
                  id="project-create-start"
                  type="date"
                  value={startOn}
                  aria-describedby="project-create-start-hint"
                  onChange={(event): void => setStartOn(event.target.value)}
                />
                <p id="project-create-start-hint" className="text-xs text-muted-foreground">
                  {t('field.startOnHint')}
                </p>
              </div>
              <div id="project-create-value-hint" className="space-y-1 md:col-span-2">
                {errors.value || errors.currency ? (
                  <>
                    {fieldError('project-create-value-error', errors.value)}
                    {fieldError('project-create-currency-error', errors.currency)}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('field.valueHint')}</p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="project-create-description">{t('field.description')}</Label>
              <ReferenceField
                id="project-create-description"
                rows={4}
                value={description}
                onValueChange={setDescription}
                kinds={references.kinds}
                lookups={references.lookups}
                maxLength={PROJECT_DESCRIPTION_MAX}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {template ? (
              <TemplateStages template={template} tasksPresent={tasksPresent} />
            ) : (
              <>
                <fieldset className="space-y-3">
                  <legend className="text-base font-semibold">
                    {t('create.stages.section')}
                    {required}
                  </legend>
                  <ol className="space-y-3">
                    {stages.map((row, index) => {
                      const position = index + 1;
                      const nameInvalid = errors.stageName !== undefined && row.name.trim() === '';
                      const durationInvalid = errors.stageDuration !== undefined && parseDuration(row.duration) === null;
                      return (
                        <li key={row.key} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
                          <span aria-hidden="true" className="min-h-9 pt-2 text-sm font-medium tabular-nums text-muted-foreground">
                            {position}.
                          </span>
                          <div className="min-w-48 flex-1 space-y-1">
                            <Label htmlFor={`project-create-stage-${row.key}-name`} className="text-xs text-muted-foreground">
                              <span aria-hidden="true">{t('stage.nameShort')}</span>
                            </Label>
                            <Input
                              id={`project-create-stage-${row.key}-name`}
                              aria-label={t('stage.name', { position })}
                              value={row.name}
                              maxLength={80}
                              aria-invalid={nameInvalid}
                              onChange={(event): void => updateStage(index, { name: event.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <span aria-hidden="true" className="block text-xs text-muted-foreground">
                              {t('stage.colorShort')}
                            </span>
                            <ColorPicker
                              value={row.color}
                              onChange={(color): void => updateStage(index, { color })}
                              label={t('stage.color', { position })}
                              customLabel={t('stage.colorCustom', { position })}
                            />
                          </div>
                          <div className="w-24 space-y-1">
                            <Label htmlFor={`project-create-stage-${row.key}-days`} className="text-xs text-muted-foreground">
                              <span aria-hidden="true">{t('stage.durationShort')}</span>
                            </Label>
                            <Input
                              id={`project-create-stage-${row.key}-days`}
                              aria-label={t('stage.duration', { position })}
                              inputMode="numeric"
                              value={row.duration}
                              aria-invalid={durationInvalid}
                              onChange={(event): void => updateStage(index, { duration: event.target.value })}
                            />
                          </div>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                              aria-label={t('stage.moveUp', { position })}
                              disabled={index === 0}
                              onClick={(): void => moveStage(index, -1)}
                            >
                              <ArrowUp aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                              aria-label={t('stage.moveDown', { position })}
                              disabled={index === stages.length - 1}
                              onClick={(): void => moveStage(index, 1)}
                            >
                              <ArrowDown aria-hidden="true" />
                            </Button>
                            {stages.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="min-h-11 min-w-11 text-destructive hover:text-destructive sm:min-h-9 sm:min-w-9"
                                aria-label={t('stage.remove', { position })}
                                onClick={(): void => setStages((previous) => previous.filter((_, at) => at !== index))}
                              >
                                <Trash2 aria-hidden="true" />
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {fieldError('project-create-stage-name-error', errors.stageName)}
                  {fieldError('project-create-stage-duration-error', errors.stageDuration)}
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    disabled={stages.length >= 50}
                    onClick={(): void =>
                      setStages((previous) => [
                        ...previous,
                        { key: key(), name: '', color: stageColorAt(previous.length), duration: '0' },
                      ])
                    }
                  >
                    <Plus aria-hidden="true" />
                    {t('create.stages.add')}
                  </Button>
                </fieldset>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <fieldset className="space-y-3" aria-describedby="project-create-members-hint">
              <legend className="text-base font-semibold">{t('create.members.section')}</legend>
              <p id="project-create-members-hint" className="text-sm text-muted-foreground">
                {t('create.members.hint')}
              </p>
              {rolesFailed ? (
                <p role="alert" className="text-xs text-destructive">
                  {t('create.members.rolesError')}
                </p>
              ) : null}
              <ul className="space-y-3">
                {members.map((row, index) => {
                  const position = index + 1;
                  const personId = `project-create-member-${row.key}`;
                  return (
                    <li key={row.key} className="space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-56 flex-1 space-y-1">
                          <Label htmlFor={personId}>{t('create.members.person', { position })}</Label>
                          <AdminUserLookup
                            id={personId}
                            ariaLabel={t('create.members.person', { position })}
                            value={row.adminUserId}
                            onChange={(adminUserId): void => updateMember(index, { adminUserId })}
                            placeholder={t('field.personPlaceholder')}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="min-h-11 min-w-11 text-destructive hover:text-destructive sm:min-h-9 sm:min-w-9"
                          aria-label={t('create.members.remove', { position })}
                          onClick={(): void => setMembers((previous) => previous.filter((_, at) => at !== index))}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                      {offeredRoles.length > 0 ? (
                        <fieldset>
                          <legend className="sr-only">{t('create.members.roles', { position })}</legend>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {offeredRoles.map((role) => {
                              const id = `${personId}-role-${role.id}`;
                              return (
                                <label key={role.id} htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                                  <Checkbox
                                    id={id}
                                    checked={row.roleIds.includes(role.id)}
                                    onChange={(event): void => toggleRole(index, role.id, event.target.checked)}
                                  />
                                  {role.archivedAt ? t('overview.archivedRole', { role: role.label }) : role.label}
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {fieldError('project-create-member-error', errors.member)}
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:min-h-9"
                onClick={(): void => setMembers((previous) => [...previous, { key: key(), adminUserId: null, roleIds: [] }])}
              >
                <Plus aria-hidden="true" />
                {t('create.members.add')}
              </Button>
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <VisibilityControl value={visibility} onChange={setVisibility} disabled={busy} />
          </CardContent>
        </Card>

        <NewProjectCustomFields onChange={setCustomFieldValues} fieldErrors={customFieldErrors} />

        <StickyFormActions className="flex justify-end gap-2">
          <Button
            className="min-h-11 sm:min-h-9"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={(): void => void navigate(LIST_PATH)}
          >
            {tCore('common.action.cancel')}
          </Button>
          <Button className="min-h-11 sm:min-h-9" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? t('create.submitting') : t('create.submit')}
          </Button>
        </StickyFormActions>
      </form>
      {confirmDialog}
    </>
  );
}

/**
 * The Stages a Project gets from its Template — shown, not typed: they are
 * changed on the Project's *Stages* tab once it exists.
 */
function TemplateStages(props: { template: ProjectTemplateDetail; tasksPresent: boolean }): ReactNode {
  const t = useTranslation('projects');
  const stages = [...props.template.stages].sort((a, b) => a.position - b.position);
  return (
    <section className="space-y-3" aria-labelledby="project-create-template-stages">
      <h2 id="project-create-template-stages" className="text-base font-semibold">
        {t('create.template.stages')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('create.template.stagesHint')}</p>
      <ol aria-label={t('create.template.stages')} className="space-y-2">
        {stages.map((stage, index) => (
          <li key={stage.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
            <span aria-hidden="true" className="font-medium tabular-nums text-muted-foreground">
              {index + 1}.
            </span>
            <StageDot color={stage.color} />
            <span className="font-medium [overflow-wrap:anywhere]">{stage.name}</span>
            <span className="text-muted-foreground">{t('create.template.stageDays', { days: stage.plannedDurationDays })}</span>
            {props.tasksPresent && stage.tasks.length > 0 ? (
              <span className="text-muted-foreground">
                {t('create.template.stageTaskCount', { count: stage.tasks.length })}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default ProjectCreate;

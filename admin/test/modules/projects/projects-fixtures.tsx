import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  ProjectDetail,
  ProjectLossReason,
  ProjectRole,
  ProjectStage,
  ProjectSummary,
} from '@endora-commerce/contracts';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Shared fixtures of the Projects screen tests
 * (`specs/163-projects-and-tasks/`, User Story 1 — task T047).
 *
 * **The screens are rendered over the shipped English bundles**, the module's
 * own `i18n/en.json` and `_i18n`'s, so a test names a control by the sentence an
 * operator reads, through {@link en} — which throws for a key the bundle does
 * not carry, so a screen asking for a key nobody wrote fails here rather than
 * rendering `projects.some.key` in production.
 */

function shippedBundle(relativePath: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as Record<string, string>;
}

const PROJECTS_BUNDLE = shippedBundle('../packages/modules/projects/i18n/en.json');
const CORE_BUNDLE = shippedBundle('../packages/modules/_i18n/i18n/en.json');
const PROJECTS_BUNDLE_PL = shippedBundle('../packages/modules/projects/i18n/pl.json');
const CORE_BUNDLE_PL = shippedBundle('../packages/modules/_i18n/i18n/pl.json');

/** The Polish sentence of one of the module's own keys, for a case that reads the Polish copy. */
export function pl(key: string): string {
  const template = PROJECTS_BUNDLE_PL[key];
  if (template === undefined) throw new Error(`[projects fixtures] the shipped Polish projects bundle has no key "${key}".`);
  return template;
}

function sentence(
  bundle: Record<string, string>,
  scope: string,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template = bundle[key];
  if (template === undefined) {
    throw new Error(`[projects fixtures] the shipped English ${scope} bundle has no key "${key}".`);
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** The English sentence of one of the module's own keys. */
export function en(key: string, params?: Record<string, string | number>): string {
  return sentence(PROJECTS_BUNDLE, 'projects', key, params);
}

/** The English sentence of a key the host's shared bundle owns. */
export function core(key: string, params?: Record<string, string | number>): string {
  return sentence(CORE_BUNDLE, 'core', key, params);
}

export const EVERY_PROJECTS_PERMISSION = ['projects:read', 'projects:write', 'organizations:read', 'admin_users:read'];

/** Mount a screen at `path` (matched against `pattern`) under the real session and presence providers. */
export function renderProjects(
  ui: ReactElement,
  options: {
    readonly permissions?: readonly string[];
    readonly path?: string;
    readonly pattern?: string;
    /** The modules the presence projection names; the default leaves `tasks` absent (User Story 1). */
    readonly present?: readonly string[];
    /** Further `<Route>`s beside the subject's — a screen a write navigates to. */
    readonly routes?: ReactNode;
    /** Modules' admin contributions, for a screen that mounts a zone. */
    readonly contributions?: Parameters<typeof withSession>[1]['contributions'];
    /** The operator's language; English unless a test reads the Polish copy. */
    readonly language?: 'en' | 'pl';
  } = {},
): RenderResult {
  const language = options.language ?? 'en';
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[options.path ?? '/']}>
          <Routes>
            <Route path={options.pattern ?? '*'} element={ui} />
            {options.routes}
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: options.permissions ?? EVERY_PROJECTS_PERMISSION }),
        presence: modulePresence({ present: options.present ?? ['projects', 'organizations', 'admin_users'] }),
        registry: [],
        ...(options.contributions ? { contributions: options.contributions } : {}),
      },
    ),
    language === 'pl' ? { core: CORE_BUNDLE_PL, projects: PROJECTS_BUNDLE_PL } : { core: CORE_BUNDLE, projects: PROJECTS_BUNDLE },
    { language },
  );
}

export const PROJECT_ID = '00000000-0000-4000-8000-0000000000f1';
export const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
export const STAGE_DESIGN = '00000000-0000-4000-8000-000000000d01';
export const STAGE_BUILD = '00000000-0000-4000-8000-000000000d02';
export const STAGE_HANDOVER = '00000000-0000-4000-8000-000000000d03';
export const ROLE_SALES_REP = '00000000-0000-4000-8000-000000000e01';
export const ROLE_MANAGER = '00000000-0000-4000-8000-000000000e02';
export const REASON_PRICE = '00000000-0000-4000-8000-000000000e11';
export const ADMIN_ID = '00000000-0000-4000-8000-000000000c01';

export function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: PROJECT_ID,
    number: 'PRJ-000001',
    title: 'Warehouse fit-out',
    state: 'open',
    currentStage: { id: STAGE_DESIGN, name: 'Design', color: '#3b82f6', deadlineOn: '2026-11-05', overdue: false },
    organizations: [{ id: ORGANIZATION_ID, name: 'Acme' }],
    value: { amount: '12500.00', currency: 'PLN' },
    projectManagers: [{ id: ADMIN_ID, name: 'Anna Nowak' }],
    createdAt: '2026-10-20T10:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

export function stage(overrides: Partial<ProjectStage> & Pick<ProjectStage, 'id' | 'name' | 'position'>): ProjectStage {
  return {
    color: '#64748b',
    plannedDurationDays: 10,
    responsibleRoleIds: [],
    alertOffsetsDays: [],
    completionGate: false,
    completionPermitted: false,
    startedOn: null,
    deadlineOn: null,
    deadlineManual: false,
    tasksMaterializedAt: null,
    tasksSkippedAt: null,
    tasksMaterializeFailed: false,
    stageTasks: [],
    ...overrides,
  };
}

/** A Project in its first of three Stages; the default workflow is linear. */
export function detail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    ...summary(),
    description: 'Racking and lighting for the new hall.',
    references: [],
    startOn: '2026-10-20',
    visibility: 'inherit',
    viewers: [],
    template: null,
    lostStageId: null,
    lossReason: null,
    lossComment: null,
    stages: [
      stage({ id: STAGE_DESIGN, name: 'Design', position: 0, color: '#3b82f6', startedOn: '2026-10-20', deadlineOn: '2026-11-05' }),
      stage({ id: STAGE_BUILD, name: 'Build', position: 1, color: '#f59e0b' }),
      stage({ id: STAGE_HANDOVER, name: 'Handover', position: 2, color: '#10b981', completionPermitted: true }),
    ],
    moves: [
      { fromStageId: STAGE_DESIGN, toStageId: STAGE_BUILD },
      { fromStageId: STAGE_BUILD, toStageId: STAGE_HANDOVER },
    ],
    unreachableStageIds: [],
    members: [
      {
        id: '00000000-0000-4000-8000-000000000b01',
        adminUser: { id: ADMIN_ID, name: 'Anna Nowak', active: true },
        roles: [{ id: ROLE_MANAGER, name: 'Project Manager', archived: false }],
        addedAt: '2026-10-20T10:00:00.000Z',
      },
    ],
    linkCount: 0,
    unreadMessageCount: 0,
    customFieldValues: {},
    version: 3,
    permissions: { canWrite: true, canConfigure: false },
    ...overrides,
  };
}

function dictionaryEntry(id: string, code: string, label: string, position: number): ProjectRole {
  return {
    id,
    code,
    name: { en: label },
    defaultName: label,
    label,
    isSystem: true,
    archivedAt: null,
    position,
  };
}

export const ROLES: ProjectRole[] = [
  dictionaryEntry(ROLE_SALES_REP, 'sales_rep', 'Sales Rep', 0),
  dictionaryEntry(ROLE_MANAGER, 'project_manager', 'Project Manager', 1),
];

export const LOSS_REASONS: ProjectLossReason[] = [
  dictionaryEntry(REASON_PRICE, 'price', 'Price', 0),
  dictionaryEntry('00000000-0000-4000-8000-000000000e12', 'competitor', 'Chose a competitor', 1),
];

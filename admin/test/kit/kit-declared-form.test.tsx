import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  defineAdminForm,
  defineFieldSet,
  type AdminFieldBehaviour,
  type AdminFieldContribution,
  type AdminInputControlContribution,
  type EffectiveField,
  type EffectiveFormsResponse,
  type FieldSlotProps,
} from '@endora-commerce/contracts';
import {
  FIELD_CONDITION_VECTORS,
  FIELD_FORMAT_VECTORS,
} from '@endora-commerce/contracts/admin-forms.vectors';
import {
  ApiError,
  AuthProvider,
  EffectiveFormsProvider,
  ModulePresenceProvider,
  checkPlatformFieldFormat,
  clientFieldViolations,
  mapDeclaredFormError,
} from '@endora-commerce/admin-kit/lib';
import {
  DeclaredFormNotices,
  DeclaredFormProvider,
  DeclaredFormSection,
  useDeclaredForm,
  type DeclaredControlProps,
  type DeclaredFormController,
  type DeclaredFieldRenderers,
} from '@endora-commerce/admin-kit/components';
import { AdminContributionsProvider } from '@endora-commerce/admin-kit/zones';
import { TranslationProvider, type Bundle } from '@endora-commerce/admin-kit/i18n';
import { Input } from '@endora-commerce/admin-kit/ui';
import { adminSession, modulePresence } from '../helpers/render-with-session';

/**
 * `specs/193-admin-form-extensions/` T038 — `DeclaredFormSection`, the one
 * layout primitive an adopting host renders its declared fields through
 * (FR-004, FR-011, FR-016, FR-032 client side, FR-044, FR-052, FR-061, FR-062;
 * `contracts/field-slots.md` §2 – §3, `field-rules.md` §6, D-300.11, D-300.12).
 *
 * The subject is driven through the real providers — session, presence,
 * translations, contributions and the effective forms — over data, never
 * stubs of the predicates, so a gate asserted here is the gate in production.
 */

// ---------------------------------------------------------------------------
// Fixture: a field set, two forms, the server's effective forms
// ---------------------------------------------------------------------------

const ALL = ['label', 'help', 'placeholder', 'position', 'default', 'readOnly', 'hidden', 'control', 'behaviour', 'visibleWhen', 'validation', 'requiredWhen', 'writePermission'] as const;

const FIELD_SET = defineFieldSet({
  id: 'organization',
  ownerModuleId: 'organizations',
  fields: [
    { key: 'name', type: 'string', required: true, bounds: { maxLength: 255 }, accepts: ['label', 'writePermission', 'validation'] },
    { key: 'taxId', type: 'string', required: true, accepts: ['label', 'control', 'behaviour'] },
    { key: 'phone', type: 'string', required: false, accepts: [...ALL] },
    { key: 'status', type: 'enum', options: ['active', 'blocked'], required: true, accepts: ['label'] },
    { key: 'reason', type: 'string', required: false, accepts: [...ALL] },
    { key: 'website', type: 'string', required: false, accepts: [...ALL] },
    { key: 'displayName', type: 'string', required: false, accepts: [...ALL] },
    { key: 'parentId', type: 'reference', references: 'organization', required: false, accepts: [...ALL] },
  ],
});

const SECTIONS = [
  { key: 'identity', keys: ['name', 'taxId', 'phone', 'status', 'reason', 'website', 'displayName'] },
  { key: 'extra', keys: ['parentId'] },
] as const;

const FORMS = {
  create: defineAdminForm({ id: 'organization.create', fieldSet: 'organization', mode: 'create', sections: SECTIONS }),
  edit: defineAdminForm({ id: 'organization.edit', fieldSet: 'organization', mode: 'edit', sections: SECTIONS }),
} as const;

function effectiveFields(overrides: Partial<Record<string, Partial<EffectiveField>>> = {}): EffectiveField[] {
  let order = 0;
  return SECTIONS.flatMap((section) =>
    section.keys.map((key): EffectiveField => ({
      key,
      section: section.key,
      order: order++,
      readOnly: false,
      hidden: false,
      control: null,
      overriddenBy: [],
      operatorKinds: [],
      ...overrides[key],
    })),
  );
}

const BLOCKED = { field: 'status', op: 'equals', value: 'blocked' } as const;

/** What `GET /api/v1/admin/effective-forms` answers for the fixture deployment. */
function effectiveForms(overrides: Partial<Record<string, Partial<EffectiveField>>> = {}): EffectiveFormsResponse {
  const base: Partial<Record<string, Partial<EffectiveField>>> = {
    name: { writePermission: 'customers:rename' },
    taxId: { label: { source: 'code', module: 'acme_overlay', key: 'labels.nip' } },
    phone: {
      label: { source: 'operator', text: { en: 'Mobile', pl: 'Komórka' } },
      validation: { required: true, maxLength: 20, format: 'tel' },
      control: 'platform.tel',
      operatorKinds: ['label'],
    },
    reason: { visibleWhen: BLOCKED, requiredWhen: BLOCKED },
    website: { hidden: true },
    displayName: { readOnly: true },
    parentId: { readOnly: true },
    ...overrides,
  };
  const fields = effectiveFields(base);
  return {
    forms: [
      { id: FORMS.create.id, fieldSet: 'organization', fields },
      { id: FORMS.edit.id, fieldSet: 'organization', fields },
    ],
  };
}

// ---------------------------------------------------------------------------
// Fixture: contributions
// ---------------------------------------------------------------------------

function ErpCode(props: FieldSlotProps<string>): ReactNode {
  return (
    <Input
      {...props.control}
      value={props.value ?? ''}
      readOnly={props.readOnly}
      onChange={(event): void => props.onChange(event.target.value)}
    />
  );
}

function NipControl(props: DeclaredControlProps): ReactNode {
  return (
    <Input
      {...props.control}
      data-control="acme_controls.nip"
      value={typeof props.value === 'string' ? props.value : ''}
      readOnly={props.readOnly}
      onChange={(event): void => props.onChange(event.target.value)}
    />
  );
}

const slot = (contribution: Omit<AdminFieldContribution, 'component' | 'weight' | 'type' | 'fieldSet'> & Partial<AdminFieldContribution>): AdminFieldContribution => ({
  fieldSet: 'organization',
  type: 'string',
  weight: 0,
  component: () => Promise.resolve({ default: ErpCode }),
  ...contribution,
});

const DISPLAY_NAME_DERIVATION: AdminFieldBehaviour = {
  target: 'organization.displayName',
  behaviour: () =>
    Promise.resolve({
      default: { derive: { from: ['name'], compute: (values: Readonly<Record<string, unknown>>) => String(values.name ?? '').toUpperCase() } },
    }),
};

const PHONE_MASK: AdminFieldBehaviour = {
  target: 'organization.phone',
  behaviour: () => Promise.resolve({ default: { mask: (raw: string) => raw.replace(/[^0-9+ ]/gu, '') } }),
};

const NIP_CONTROL: AdminInputControlContribution = {
  id: 'acme_controls.nip',
  component: () => Promise.resolve({ default: NipControl }),
};

const CONTRIBUTIONS = [
  {
    moduleId: 'acme_erp',
    contributions: {
      fields: [slot({ key: 'code', labelKey: 'slot.code', helpKey: 'slot.codeHelp', anchor: { field: 'taxId', position: 'after' } })],
    },
  },
  {
    moduleId: 'acme_off',
    contributions: { fields: [slot({ key: 'flag', labelKey: 'slot.flag', anchor: { field: 'name', position: 'after' } })] },
  },
  {
    moduleId: 'acme_perm',
    contributions: {
      fields: [slot({ key: 'secret', labelKey: 'slot.secret', anchor: { field: 'name', position: 'after' }, requiredPermission: 'secrets:read' })],
    },
  },
  {
    moduleId: 'acme_edit_only',
    contributions: {
      fields: [slot({ key: 'note', labelKey: 'slot.note', forms: ['organization.edit'], anchor: { section: 'extra', position: 'end' } })],
    },
  },
  { moduleId: 'acme_overlay', contributions: { fieldBehaviours: [DISPLAY_NAME_DERIVATION, PHONE_MASK] } },
  { moduleId: 'acme_controls', contributions: { controls: [NIP_CONTROL] } },
];

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;

function bundleFor(language: 'en' | 'pl'): Bundle {
  return {
    core: read(`../packages/modules/_i18n/i18n/${language}.json`),
    _lifecycle: read(`../packages/platform/src/lifecycle/i18n/${language}.json`),
    acme_overlay: { 'labels.nip': language === 'en' ? 'NIP' : 'NIP (PL)' },
    acme_erp: { 'slot.code': language === 'en' ? 'ERP code' : 'Kod ERP', 'slot.codeHelp': 'From the ERP.' },
    acme_off: { 'slot.flag': 'Flag' },
    acme_perm: { 'slot.secret': 'Secret' },
    acme_edit_only: { 'slot.note': 'Edit note' },
    acme_locked: { 'slot.code': 'Locked code' },
  };
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

type Values = Record<string, unknown>;

function renderers(): DeclaredFieldRenderers<typeof FORMS.create> {
  const text = (label: string): DeclaredFieldRenderers<typeof FORMS.create>['name'] => ({
    label,
    input: (p) => (
      <Input
        {...p.control}
        value={typeof p.value === 'string' ? p.value : ''}
        readOnly={p.readOnly}
        {...(p.placeholder === undefined ? {} : { placeholder: p.placeholder })}
        onChange={(event): void => p.onChange(event.target.value)}
      />
    ),
  });
  return {
    name: text('Name'),
    taxId: text('Tax ID'),
    phone: text('Phone'),
    status: {
      label: 'Status',
      input: (p) => (
        <select {...p.control} value={String(p.value ?? '')} disabled={p.readOnly} onChange={(event): void => p.onChange(event.target.value)}>
          <option value="active">active</option>
          <option value="blocked">blocked</option>
        </select>
      ),
    },
    reason: text('Reason'),
    website: text('Website'),
    displayName: text('Display name'),
    parentId: text('Parent organization'),
  };
}

let controller: DeclaredFormController | null = null;

function Host({
  mode,
  initial,
  extensions,
}: {
  mode: 'create' | 'edit';
  initial: Values;
  extensions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}): ReactNode {
  const [values, setValues] = useState<Values>(initial);
  const loaded = useRef(initial);
  const declared = useDeclaredForm({
    form: mode === 'create' ? FORMS.create : FORMS.edit,
    fieldSet: FIELD_SET,
    recordId: mode === 'create' ? null : 'org-1',
    values,
    initialValues: loaded.current,
    onChange: (key, value) => setValues((current) => ({ ...current, [key]: value })),
    extensions: extensions ?? null,
    render: renderers(),
  });
  controller = declared;
  return (
    <DeclaredFormProvider declared={declared}>
      <DeclaredFormNotices />
      <section aria-label="identity">
        <DeclaredFormSection section="identity" />
      </section>
      <DeclaredFormSection
        section="extra"
        frame={(content) => (
          <section aria-label="extra">{content}</section>
        )}
      />
    </DeclaredFormProvider>
  );
}

function mount(
  ui: ReactElement,
  options: {
    language?: 'en' | 'pl';
    permissions?: readonly string[];
    present?: readonly string[];
    absent?: readonly string[];
    forms?: EffectiveFormsResponse;
  } = {},
) {
  const language = options.language ?? 'en';
  const bundle = bundleFor(language);
  return render(
    <TranslationProvider language={language} initialBundle={bundle} initialFallbackBundle={bundleFor('en')}>
      <AuthProvider initial={adminSession({ permissions: options.permissions ?? ['customers:rename'] })}>
        <ModulePresenceProvider
          initial={modulePresence({
            present: options.present ?? ['organizations', 'acme_erp', 'acme_perm', 'acme_overlay', 'acme_controls', 'acme_edit_only'],
            absent: options.absent ?? ['acme_off'],
          })}
        >
          <AdminContributionsProvider entries={CONTRIBUTIONS}>
            <EffectiveFormsProvider initial={options.forms ?? effectiveForms()}>{ui}</EffectiveFormsProvider>
          </AdminContributionsProvider>
        </ModulePresenceProvider>
      </AuthProvider>
    </TranslationProvider>,
  );
}

const CREATE_VALUES: Values = { name: 'Acme', taxId: '5250001009', phone: '+48 600 100 200', status: 'active', reason: '', website: 'https://acme.test', displayName: '', parentId: 'p-1' };

/** The labels of the rendered fields of a section, in order. */
function labelsIn(section: string): string[] {
  return within(screen.getByRole('region', { name: section }))
    .getAllByText((_, element) => element?.tagName === 'LABEL')
    .map((label) => (label.textContent ?? '').replace(/\s*\*$/u, '').trim());
}

const declaredController = (): DeclaredFormController => {
  if (controller === null) throw new Error('the host did not render');
  return controller;
};

beforeEach(() => {
  controller = null;
});

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

describe('overrides from the effective forms', () => {
  it('takes a code label from the declaring module’s bundle and an operator label in the reader’s language', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    expect(await screen.findByLabelText(/^NIP/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Mobile/u)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Tax ID/u)).toBeNull();
  });

  it('reads the same overrides in Polish', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />, { language: 'pl' });
    expect(await screen.findByLabelText(/^NIP \(PL\)/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Komórka/u)).toBeInTheDocument();
  });

  it('renders nothing for a hidden field and a read-only control for a read-only one', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    await screen.findByLabelText(/^NIP/u);
    expect(screen.queryByLabelText('Website')).toBeNull();
    expect(screen.getByLabelText('Parent organization')).toHaveAttribute('readonly');
  });

  it('renders a field read-only for an operator without its writePermission (FR-061)', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />, { permissions: [] });
    await screen.findByLabelText(/^NIP/u);
    expect(screen.getByLabelText(/^Name/u)).toHaveAttribute('readonly');
  });

  it('marks a tightened required field required', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    expect(await screen.findByLabelText(/^Mobile/u)).toHaveAttribute('aria-required', 'true');
  });

  it('renders the platform control a control override selects, in place of the host’s input', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    expect(await screen.findByLabelText(/^Mobile/u)).toHaveAttribute('type', 'tel');
  });

  it('renders a module’s control while its module is present, and the host’s input when it is off', async () => {
    const forms = effectiveForms({ taxId: { label: { source: 'code', module: 'acme_overlay', key: 'labels.nip' }, control: 'acme_controls.nip' } });
    const first = mount(<Host mode="create" initial={CREATE_VALUES} />, { forms });
    await waitFor(() => expect(screen.getByLabelText(/^NIP/u)).toHaveAttribute('data-control', 'acme_controls.nip'));
    first.unmount();

    mount(<Host mode="create" initial={CREATE_VALUES} />, {
      forms,
      present: ['organizations', 'acme_erp', 'acme_perm', 'acme_overlay', 'acme_edit_only'],
      absent: ['acme_off', 'acme_controls'],
    });
    expect(await screen.findByLabelText(/^NIP/u)).not.toHaveAttribute('data-control');
  });
});

describe('visibleWhen', () => {
  it('shows a conditional field only while its condition holds', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    await screen.findByLabelText(/^NIP/u);
    expect(screen.queryByLabelText(/^Reason/u)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Status/u), { target: { value: 'blocked' } });
    expect(await screen.findByLabelText(/^Reason/u)).toHaveAttribute('aria-required', 'true');
  });
});

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

describe('slot fields', () => {
  it('renders a present module’s slot at its anchor, with its label from the module’s bundle', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    expect(await screen.findByRole('textbox', { name: 'ERP code' })).toBeInTheDocument();
    expect(labelsIn('identity')).toEqual(['Name', 'NIP', 'ERP code', 'Mobile', 'Status', 'Display name']);
  });

  it('renders no slot of a switched-off module and none the operator may not see', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    await screen.findByRole('textbox', { name: 'ERP code' });
    expect(screen.queryByLabelText('Flag')).toBeNull();
    expect(screen.queryByLabelText('Secret')).toBeNull();
  });

  it('renders a slot the operator may see once it holds the permission', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />, { permissions: ['customers:rename', 'secrets:read'] });
    expect(await screen.findByLabelText('Secret')).toBeInTheDocument();
  });

  it('renders a slot narrowed to the edit form on that form only, at a section end', async () => {
    const first = mount(<Host mode="create" initial={CREATE_VALUES} />);
    await screen.findByRole('textbox', { name: 'ERP code' });
    expect(screen.queryByLabelText('Edit note')).toBeNull();
    first.unmount();
    mount(<Host mode="edit" initial={CREATE_VALUES} extensions={{ acme_edit_only: { note: 'kept' } }} />);
    expect(await screen.findByLabelText('Edit note')).toHaveValue('kept');
    expect(labelsIn('extra')).toEqual(['Parent organization', 'Edit note']);
  });

  it('reads a slot’s value from the host read’s extensions', async () => {
    mount(<Host mode="edit" initial={CREATE_VALUES} extensions={{ acme_erp: { code: 'E-1' } }} />);
    expect(await screen.findByRole('textbox', { name: 'ERP code' })).toHaveValue('E-1');
  });

  it('lists the modules whose slots it renders, for the host’s ?extensions= read', async () => {
    mount(<Host mode="edit" initial={CREATE_VALUES} />);
    await screen.findByRole('textbox', { name: 'ERP code' });
    expect(declaredController().extensionModules).toEqual(['acme_edit_only', 'acme_erp']);
  });
});

// ---------------------------------------------------------------------------
// Client rules (field-rules.md §6, D-300.11)
// ---------------------------------------------------------------------------

describe('client rules', () => {
  it('refuses an empty tightened required field before submitting, with the platform sentence', async () => {
    mount(<Host mode="create" initial={{ ...CREATE_VALUES, phone: '' }} />);
    await screen.findByLabelText(/^NIP/u);
    let ok = true;
    act(() => {
      ok = declaredController().validate();
    });
    expect(ok).toBe(false);
    expect(screen.getByLabelText(/^Mobile/u)).toHaveAccessibleDescription('This field is required.');
  });

  it('refuses a value outside the tightened format and bounds', async () => {
    mount(<Host mode="create" initial={{ ...CREATE_VALUES, phone: 'abc' }} />);
    await screen.findByLabelText(/^NIP/u);
    act(() => {
      declaredController().validate();
    });
    expect(screen.getByLabelText(/^Mobile/u)).toHaveAccessibleDescription('The value is not in the required format.');
  });

  it('holds requiredWhen when the field its condition reads is set to make it required', async () => {
    mount(<Host mode="create" initial={{ ...CREATE_VALUES, status: 'blocked' }} />);
    await screen.findByLabelText(/^Reason/u);
    act(() => {
      declaredController().validate();
    });
    expect(screen.getByLabelText(/^Reason/u)).toHaveAccessibleDescription('This field is required.');
  });

  it('on an edit form does not hold an unchanged field to a rule added after it was stored (D-300.11)', async () => {
    mount(<Host mode="edit" initial={{ ...CREATE_VALUES, phone: '' }} />);
    const name = await screen.findByLabelText(/^Name/u);
    fireEvent.change(name, { target: { value: 'Acme 2' } });
    let ok = false;
    act(() => {
      ok = declaredController().validate();
    });
    expect(ok).toBe(true);
  });

  it('on an edit form holds requiredWhen when a field its condition reads changed (D-300.11)', async () => {
    mount(<Host mode="edit" initial={{ ...CREATE_VALUES }} />);
    const status = await screen.findByLabelText(/^Status/u);
    fireEvent.change(status, { target: { value: 'blocked' } });
    await screen.findByLabelText(/^Reason/u);
    let ok = true;
    act(() => {
      ok = declaredController().validate();
    });
    expect(ok).toBe(false);
    expect(screen.getByLabelText(/^Reason/u)).toHaveAccessibleDescription('This field is required.');
  });

  it('answers each condition vector as the server does', () => {
    const set = defineFieldSet({
      id: 'probe',
      ownerModuleId: 'probe',
      fields: [{ key: 'target', type: 'string', required: false, accepts: ['requiredWhen'] }],
    });
    for (const vector of FIELD_CONDITION_VECTORS) {
      const violations = clientFieldViolations({
        mode: 'create',
        fieldSet: set,
        fields: [{ key: 'target', section: 's', order: 0, readOnly: false, hidden: false, control: null, requiredWhen: vector.condition, overriddenBy: [], operatorKinds: [] }],
        keys: ['target'],
        values: vector.values,
      });
      expect(violations.some((violation) => violation.code === 'required'), vector.name).toBe(vector.expected);
    }
  });

  it('answers each platform format vector as the server’s validators do', () => {
    for (const [format, { accept, refuse }] of Object.entries(FIELD_FORMAT_VECTORS)) {
      for (const value of accept) expect(checkPlatformFieldFormat(format, value), `${format} accepts ${value}`).toBe(true);
      for (const value of refuse) expect(checkPlatformFieldFormat(format, value), `${format} refuses ${value}`).toBe(false);
    }
    expect(checkPlatformFieldFormat('acme.nip', '123')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Server errors
// ---------------------------------------------------------------------------

const ruleViolation = (details: readonly Record<string, unknown>[], code = 'FIELD_RULE_VIOLATION', status = 422): ApiError =>
  new ApiError(status, { error: { code: code as 'INTERNAL', message: 'refused', details: details as never } });

describe('server details mapped by path', () => {
  it('puts a core key’s detail on the field and an extensions.<moduleId>.<key> detail on the slot', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    await screen.findByRole('textbox', { name: 'ERP code' });
    let handled = false;
    act(() => {
      handled = declaredController().applyError(
        ruleViolation([
          { path: 'phone', code: 'too_long', params: { limit: 20 }, message: 'Wpisz co najwyżej 20 znaków.' },
          { path: 'extensions.acme_erp.code', issue: 'Expected a string of 8 digits' },
        ]),
      );
    });
    expect(handled).toBe(true);
    expect(screen.getByLabelText(/^Mobile/u)).toHaveAccessibleDescription('Wpisz co najwyżej 20 znaków.');
    expect(screen.getByRole('textbox', { name: 'ERP code' })).toHaveAccessibleDescription(/Expected a string of 8 digits/u);
  });

  it('maps a nested path onto the field it is inside, and leaves an error with no field to the host', () => {
    const mapped = mapDeclaredFormError(
      ruleViolation([{ path: 'registeredAddress.city', issue: 'Required' }, { path: 'extensions.acme_erp.code.0', issue: 'Bad' }], 'VALIDATION_FAILED', 400),
      ['registeredAddress', 'acme_erp.code'],
    );
    expect(mapped?.fields).toEqual({ registeredAddress: 'Required', 'acme_erp.code': 'Bad' });
    expect(mapDeclaredFormError(new Error('network'), ['name'])).toBeNull();
  });

  it('maps a 403 FIELD_WRITE_FORBIDDEN detail onto its field', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    await screen.findByLabelText(/^NIP/u);
    act(() => {
      declaredController().applyError(
        ruleViolation([{ path: 'name', permission: 'customers:rename', reason: 'missing-permission', message: 'You do not have permission to change this field.' }], 'FIELD_WRITE_FORBIDDEN', 403),
      );
    });
    expect(screen.getByLabelText(/^Name/u)).toHaveAccessibleDescription('You do not have permission to change this field.');
  });
});

// ---------------------------------------------------------------------------
// Submission (field-slots.md §3, FR-016, D-300.12)
// ---------------------------------------------------------------------------

describe('submission', () => {
  it('splits core fields from extensions and omits hidden and plain read-only fields', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    const code = await screen.findByRole('textbox', { name: 'ERP code' });
    fireEvent.change(code, { target: { value: 'E-42' } });
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('ACME'));
    const submission = declaredController().submission();
    expect(submission.core).toEqual({
      name: 'Acme',
      taxId: '5250001009',
      phone: '+48 600 100 200',
      status: 'active',
      // Read-only, and targeted by a present derivation: submitted with its derived value (D-300.12).
      displayName: 'ACME',
    });
    expect(submission.core).not.toHaveProperty('website');
    expect(submission.core).not.toHaveProperty('parentId');
    // `reason` is not visible (status is not blocked), so it is not submitted either.
    expect(submission.core).not.toHaveProperty('reason');
    expect(submission.extensions).toEqual({ acme_erp: { code: 'E-42' } });
  });

  it('on an edit form submits only the slot values the operator changed, and no extensions when none changed', async () => {
    mount(<Host mode="edit" initial={{ ...CREATE_VALUES, displayName: 'ACME' }} extensions={{ acme_erp: { code: 'E-1' }, acme_edit_only: { note: 'kept' } }} />);
    await screen.findByRole('textbox', { name: 'ERP code' });
    const before = declaredController().submission();
    expect(before.extensions).toBeUndefined();
    // Unchanged derived read-only field on an edit form: not submitted.
    expect(before.core).not.toHaveProperty('displayName');
    const note = screen.getByLabelText('Edit note');
    fireEvent.change(note, { target: { value: 'changed' } });
    expect(declaredController().submission().extensions).toEqual({ acme_edit_only: { note: 'changed' } });
  });

  it('drops an operator change to a field it renders read-only, and still applies a derivation to one (D-300.18)', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    const parent = await screen.findByLabelText('Parent organization');
    fireEvent.change(parent, { target: { value: 'p-2' } });
    expect(parent).toHaveValue('p-1');
    expect(declaredController().submission().core).not.toHaveProperty('parentId');
    const displayName = screen.getByLabelText('Display name');
    await waitFor(() => expect(displayName).toHaveValue('ACME'));
    fireEvent.change(displayName, { target: { value: 'typed' } });
    expect(displayName).toHaveValue('ACME');
    fireEvent.change(screen.getByLabelText(/^Name/u), { target: { value: 'Beta' } });
    await waitFor(() => expect(displayName).toHaveValue('BETA'));
    expect(declaredController().submission().core).toMatchObject({ displayName: 'BETA' });
  });

  it('drops an operator change to a slot the operator may not write (D-300.18)', async () => {
    const forms = effectiveForms();
    render(
      <TranslationProvider language="en" initialBundle={bundleFor('en')} initialFallbackBundle={bundleFor('en')}>
        <AuthProvider initial={adminSession({ permissions: ['customers:rename'] })}>
          <ModulePresenceProvider initial={modulePresence({ present: ['organizations', 'acme_locked'] })}>
            <AdminContributionsProvider
              entries={[{ moduleId: 'acme_locked', contributions: { fields: [slot({ key: 'code', labelKey: 'slot.code', anchor: { field: 'taxId', position: 'after' }, writePermission: 'erp:write' })] } }]}
            >
              <EffectiveFormsProvider initial={forms}>
                <Host mode="create" initial={CREATE_VALUES} />
              </EffectiveFormsProvider>
            </AdminContributionsProvider>
          </ModulePresenceProvider>
        </AuthProvider>
      </TranslationProvider>,
    );
    const code = await screen.findByRole('textbox', { name: 'Locked code' });
    fireEvent.change(code, { target: { value: 'E-9' } });
    expect(code).toHaveValue('');
    expect(declaredController().submission().extensions).toBeUndefined();
  });

  it('on an edit form returns a derived target to its loaded value when its source returns to its loaded value (D-300.20)', async () => {
    mount(<Host mode="edit" initial={{ ...CREATE_VALUES, displayName: 'Acme Ltd' }} />);
    const name = await screen.findByLabelText(/^Name/u);
    const displayName = screen.getByLabelText('Display name');
    // Opening the record rewrites nothing.
    expect(displayName).toHaveValue('Acme Ltd');
    fireEvent.change(name, { target: { value: 'Beta' } });
    await waitFor(() => expect(displayName).toHaveValue('BETA'));
    fireEvent.change(name, { target: { value: 'Acme' } });
    await waitFor(() => expect(displayName).toHaveValue('Acme Ltd'));
    expect(declaredController().submission().core).not.toHaveProperty('displayName');
  });

  it('applies a mask behaviour to what the operator types', async () => {
    mount(<Host mode="create" initial={{ ...CREATE_VALUES, phone: '' }} />);
    const phone = await screen.findByLabelText(/^Mobile/u);
    // The mask's chunk loads lazily; until it lands, input passes through unmasked.
    await waitFor(() => {
      fireEvent.change(phone, { target: { value: '600a' } });
      expect(phone).toHaveValue('600');
    });
  });
});

// ---------------------------------------------------------------------------
// The switched-off slot (spec Edge Cases, FR-052)
// ---------------------------------------------------------------------------

describe('a slot module switched off while the form is open', () => {
  it('drops the field on COMMAND_EXTENSION_UNCLAIMED with the save session’s notice and keeps the other changes', async () => {
    // The form refreshes presence, and with it the effective forms (FR-024): both answered here.
    const requested: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
      requested.push(url.pathname);
      const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/api/v1/admin/module-presence') {
        return json(modulePresence({ present: ['organizations', 'acme_perm', 'acme_overlay', 'acme_controls', 'acme_edit_only'], absent: ['acme_off', 'acme_erp'] }));
      }
      if (url.pathname === '/api/v1/admin/effective-forms') return json(effectiveForms());
      return original(input);
    }) as typeof fetch;
    onTestFinished(() => {
      globalThis.fetch = original;
    });
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    const code = await screen.findByRole('textbox', { name: 'ERP code' });
    fireEvent.change(code, { target: { value: 'E-42' } });
    let handled = false;
    act(() => {
      handled = declaredController().applyError(
        ruleViolation([{ path: 'extensions.acme_erp', issue: "no present module hooks 'organization.create' under this key" }], 'COMMAND_EXTENSION_UNCLAIMED'),
      );
    });
    expect(handled).toBe(true);
    expect(screen.queryByRole('textbox', { name: 'ERP code' })).toBeNull();
    expect(
      screen.getByText('ERP code: unsaved changes were discarded because the module was switched off.'),
    ).toBeInTheDocument();
    const submission = declaredController().submission();
    expect(submission.extensions).toBeUndefined();
    expect(submission.core).toMatchObject({ name: 'Acme', phone: '+48 600 100 200' });
    await waitFor(() => expect(requested).toEqual(['/api/v1/admin/module-presence', '/api/v1/admin/effective-forms']));
    // After the refresh the module is off: the field stays gone, and the notice stays.
    expect(screen.queryByRole('textbox', { name: 'ERP code' })).toBeNull();
    expect(
      screen.getByText('ERP code: unsaved changes were discarded because the module was switched off.'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// No effective form yet
// ---------------------------------------------------------------------------

describe('without an effective form', () => {
  it('renders the declared core layout with the host’s labels', async () => {
    mount(<Host mode="create" initial={CREATE_VALUES} />, { forms: { forms: [] } });
    expect(await screen.findByLabelText(/^Tax ID/u)).toBeInTheDocument();
    expect(screen.getByLabelText('Website')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Review round (#2032): warnings, defaults, edit baselines, families, aria
// ---------------------------------------------------------------------------

describe('the form’s own writes and the operator’s', () => {
  it('warns once per key when it drops an operator change to a read-only field (D-300.18)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    onTestFinished(() => warn.mockRestore());
    mount(<Host mode="create" initial={CREATE_VALUES} />);
    const parent = await screen.findByLabelText('Parent organization');
    fireEvent.change(parent, { target: { value: 'p-2' } });
    fireEvent.change(parent, { target: { value: 'p-3' } });
    const dropped = warn.mock.calls.filter(([message]) => String(message).includes("read-only 'parentId'"));
    expect(dropped).toHaveLength(1);
  });

  it('fills an empty field from a default override on a create form, read-only included, and does not submit a plain read-only one', async () => {
    const forms = effectiveForms({
      phone: { default: '+48 600 000 000', label: { source: 'operator', text: { en: 'Mobile', pl: 'Komórka' } } },
      parentId: { readOnly: true, default: 'p-default' },
    });
    mount(<Host mode="create" initial={{ ...CREATE_VALUES, phone: '', parentId: '' }} />, { forms });
    await waitFor(() => expect(screen.getByLabelText(/^Mobile/u)).toHaveValue('+48 600 000 000'));
    expect(screen.getByLabelText('Parent organization')).toHaveValue('p-default');
    const core = declaredController().submission().core;
    expect(core).toMatchObject({ phone: '+48 600 000 000' });
    expect(core).not.toHaveProperty('parentId');
  });

  it('applies no default on an edit form', async () => {
    const forms = effectiveForms({ phone: { default: '+48 600 000 000' } });
    mount(<Host mode="edit" initial={{ ...CREATE_VALUES, phone: '' }} />, { forms });
    await screen.findByLabelText(/^NIP/u);
    expect(screen.getByLabelText(/^Phone/u)).toHaveValue('');
  });
});

describe('an edit form’s baseline', () => {
  it('requires initialValues on an edit form, so a record loaded after the first render is not read as changed', () => {
    // Type-level only: never called.
    function ShouldNotCompile(): ReactNode {
      // @ts-expect-error — an edit form must say what was loaded.
      useDeclaredForm({ form: FORMS.edit, fieldSet: FIELD_SET, values: {}, onChange: () => undefined, render: renderers() });
      useDeclaredForm({ form: FORMS.create, fieldSet: FIELD_SET, values: {}, onChange: () => undefined, render: renderers() });
      return null;
    }
    expect(ShouldNotCompile).toBeTypeOf('function');
  });
});

describe('field-family behaviours', () => {
  it('ignores a behaviour aimed at a family member, and loads one aimed at a declared key', async () => {
    const set = defineFieldSet({
      id: 'probe',
      ownerModuleId: 'probe',
      fields: [
        { key: 'name', type: 'string', required: false, accepts: ['behaviour'] },
        { key: 'attributeValues.*', type: 'composite', required: false, accepts: ['behaviour'] },
      ],
    });
    const form = defineAdminForm({ id: 'probe.create', fieldSet: 'probe', mode: 'create', sections: [{ key: 'main', keys: ['name', 'attributeValues.*'] }] });
    const family = vi.fn(() => Promise.resolve({ default: { mask: (raw: string) => raw } }));
    const named = vi.fn(() => Promise.resolve({ default: { mask: (raw: string) => raw.toUpperCase() } }));
    function Probe(): ReactNode {
      const [values, setValues] = useState<Values>({ name: '' });
      const declared = useDeclaredForm({
        form,
        fieldSet: set,
        values,
        onChange: (key, value) => setValues((current) => ({ ...current, [key]: value })),
        render: {
          name: { label: 'Name', input: (p) => <Input {...p.control} value={String(p.value ?? '')} onChange={(event): void => p.onChange(event.target.value)} /> },
          'attributeValues.*': { field: () => <p>attributes</p> },
        },
      });
      return (
        <DeclaredFormProvider declared={declared}>
          <DeclaredFormSection section="main" />
        </DeclaredFormProvider>
      );
    }
    render(
      <TranslationProvider language="en" initialBundle={bundleFor('en')}>
        <AuthProvider initial={adminSession({ permissions: [] })}>
          <ModulePresenceProvider initial={modulePresence({ present: ['probe', 'acme_attr'] })}>
            <AdminContributionsProvider
              entries={[{ moduleId: 'acme_attr', contributions: { fieldBehaviours: [{ target: 'probe.attributeValues.color', behaviour: family }, { target: 'probe.name', behaviour: named }] } }]}
            >
              <EffectiveFormsProvider initial={{ forms: [] }}>
                <Probe />
              </EffectiveFormsProvider>
            </AdminContributionsProvider>
          </ModulePresenceProvider>
        </AuthProvider>
      </TranslationProvider>,
    );
    await waitFor(() => expect(named).toHaveBeenCalled());
    expect(family).not.toHaveBeenCalled();
  });
});

describe('platform controls keep FormField’s wiring', () => {
  it('names an errored multiselect by its label and describes it with the error', async () => {
    const set = defineFieldSet({
      id: 'probe',
      ownerModuleId: 'probe',
      fields: [{ key: 'tags', type: 'enum[]', options: ['b2b', 'vip'], required: false, accepts: ['control', 'validation'] }],
    });
    const form = defineAdminForm({ id: 'probe.create', fieldSet: 'probe', mode: 'create', sections: [{ key: 'main', keys: ['tags'] }] });
    const forms: EffectiveFormsResponse = {
      forms: [
        {
          id: form.id,
          fieldSet: 'probe',
          fields: [{ key: 'tags', section: 'main', order: 0, readOnly: false, hidden: false, control: 'platform.multiselect', validation: { required: true }, overriddenBy: [], operatorKinds: [] }],
        },
      ],
    };
    let probe: DeclaredFormController | null = null;
    function Probe(): ReactNode {
      const [values, setValues] = useState<Values>({ tags: [] });
      const declared = useDeclaredForm({
        form,
        fieldSet: set,
        values,
        onChange: (key, value) => setValues((current) => ({ ...current, [key]: value })),
        render: { tags: { label: <em>Customer tags</em>, input: () => null } },
      });
      probe = declared;
      return (
        <DeclaredFormProvider declared={declared}>
          <DeclaredFormSection section="main" />
        </DeclaredFormProvider>
      );
    }
    render(
      <TranslationProvider language="en" initialBundle={bundleFor('en')}>
        <AuthProvider initial={adminSession({ permissions: [] })}>
          <ModulePresenceProvider initial={modulePresence({ present: ['probe'] })}>
            <AdminContributionsProvider entries={[]}>
              <EffectiveFormsProvider initial={forms}>
                <Probe />
              </EffectiveFormsProvider>
            </AdminContributionsProvider>
          </ModulePresenceProvider>
        </AuthProvider>
      </TranslationProvider>,
    );
    // A non-string label still names the trigger: by reference, never by the field key.
    const trigger = await screen.findByRole('button', { name: /^Customer tags/u });
    act(() => {
      probe?.validate();
    });
    const group = screen.getByRole('group', { name: /^Customer tags/u });
    // The field is a group: its label names it, its error describes it — a picker's trigger is a
    // button, which may carry neither `aria-required` nor the field's description on its own.
    expect(group).toHaveAccessibleDescription('This field is required.');
    expect(within(group).getByRole('button', { name: /^Customer tags/u })).toBe(trigger);
    expect(trigger).toHaveAttribute('aria-labelledby');
  });
});

// ---------------------------------------------------------------------------
// WP-E1: a host screen with no presence provider, and the provider's `form`
// ---------------------------------------------------------------------------

describe('a declared form with no module-presence provider (193 WP-E1)', () => {
  it('lays out the declaration and renders no slot: no module is present', async () => {
    render(
      <TranslationProvider language="en" initialBundle={bundleFor('en')}>
        <AuthProvider initial={adminSession({ permissions: ['*'] })}>
          <AdminContributionsProvider entries={CONTRIBUTIONS}>
            <Host mode="create" initial={CREATE_VALUES} />
          </AdminContributionsProvider>
        </AuthProvider>
      </TranslationProvider>,
    );
    expect(await screen.findByLabelText(/^Tax ID/u)).toBeInTheDocument();
    expect(screen.getByLabelText('Website')).toBeInTheDocument();
    expect(screen.queryByLabelText(/ERP code/u)).toBeNull();
    expect(declaredController().extensionModules).toEqual([]);
  });
});

describe('DeclaredFormProvider’s form (193 WP-E1, check:admin-forms)', () => {
  function Named({ form }: { form: { id: string } }): ReactNode {
    const declared = useDeclaredForm({
      form: FORMS.create,
      fieldSet: FIELD_SET,
      values: CREATE_VALUES,
      onChange: () => undefined,
      render: renderers(),
    });
    return (
      <DeclaredFormProvider form={form} declared={declared}>
        <DeclaredFormSection section="identity" />
      </DeclaredFormProvider>
    );
  }

  it('renders when it names the controller’s form', async () => {
    mount(<Named form={FORMS.create} />, { forms: { forms: [] } });
    expect(await screen.findByLabelText(/^Tax ID/u)).toBeInTheDocument();
  });

  it('refuses a form that is not the controller’s', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => error.mockRestore());
    expect(() => mount(<Named form={FORMS.edit} />, { forms: { forms: [] } })).toThrow(/organization\.edit.*organization\.create/u);
  });
});

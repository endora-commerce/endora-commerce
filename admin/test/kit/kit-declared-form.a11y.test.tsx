import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  defineAdminForm,
  defineFieldSet,
  type AdminFieldContribution,
  type EffectiveField,
  type EffectiveFormsResponse,
  type FieldSlotProps,
} from '@endora-commerce/contracts';
import {
  AuthProvider,
  EffectiveFormsProvider,
  ModulePresenceProvider,
} from '@endora-commerce/admin-kit/lib';
import {
  DeclaredFormNotices,
  DeclaredFormProvider,
  DeclaredFormSection,
  useDeclaredForm,
  type DeclaredFormController,
} from '@endora-commerce/admin-kit/components';
import { AdminContributionsProvider } from '@endora-commerce/admin-kit/zones';
import { TranslationProvider, type Bundle } from '@endora-commerce/admin-kit/i18n';
import { Input } from '@endora-commerce/admin-kit/ui';
import { expectNoAxeViolations } from '../helpers/axe';
import { adminSession, modulePresence } from '../helpers/render-with-session';

/**
 * `specs/193-admin-form-extensions/` T039 — a declared form with slot fields,
 * an override label, a platform control, a read-only field and a server error
 * passes axe's WCAG 2.2 A/AA rules: every control, the kit's and a slot's, is
 * named by its label and described by its help and error (`FormField`).
 */

const FIELD_SET = defineFieldSet({
  id: 'organization',
  ownerModuleId: 'organizations',
  fields: [
    { key: 'name', type: 'string', required: true, accepts: ['label'] },
    { key: 'phone', type: 'string', required: false, accepts: ['label', 'control', 'validation', 'readOnly'] },
    { key: 'status', type: 'enum', options: ['active', 'blocked'], required: true, accepts: ['control'] },
    { key: 'vip', type: 'boolean', required: false, accepts: ['control'] },
    { key: 'note', type: 'string', required: false, accepts: ['readOnly', 'control'] },
  ],
});

const FORM = defineAdminForm({
  id: 'organization.create',
  fieldSet: 'organization',
  mode: 'create',
  sections: [{ key: 'identity', keys: ['name', 'phone', 'status', 'vip', 'note'] }],
});

const field = (key: string, order: number, extra: Partial<EffectiveField> = {}): EffectiveField => ({
  key,
  section: 'identity',
  order,
  readOnly: false,
  hidden: false,
  control: null,
  overriddenBy: [],
  operatorKinds: [],
  ...extra,
});

const FORMS: EffectiveFormsResponse = {
  forms: [
    {
      id: FORM.id,
      fieldSet: 'organization',
      fields: [
        field('name', 0, { label: { source: 'operator', text: { en: 'Company name', pl: 'Nazwa firmy' } } }),
        field('phone', 1, { control: 'platform.tel', validation: { required: true } }),
        field('status', 2, { control: 'platform.select' }),
        field('vip', 3, { control: 'platform.switch' }),
        field('note', 4, { control: 'platform.textarea', readOnly: true }),
      ],
    },
  ],
};

function ErpCode(props: FieldSlotProps<string>): ReactNode {
  return <Input {...props.control} value={props.value ?? ''} onChange={(event): void => props.onChange(event.target.value)} />;
}

const SLOT: AdminFieldContribution = {
  fieldSet: 'organization',
  key: 'code',
  type: 'string',
  anchor: { field: 'name', position: 'after' },
  weight: 0,
  labelKey: 'slot.code',
  helpKey: 'slot.codeHelp',
  component: () => Promise.resolve({ default: ErpCode }),
};

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;

const BUNDLE: Bundle = {
  core: read('../packages/modules/_i18n/i18n/en.json'),
  _lifecycle: read('../packages/platform/src/lifecycle/i18n/en.json'),
  acme_erp: { 'slot.code': 'ERP code', 'slot.codeHelp': 'The customer number in the ERP.' },
};

let controller: DeclaredFormController | null = null;

function Host(): ReactNode {
  const [values, setValues] = useState<Record<string, unknown>>({ name: 'Acme', phone: '', status: 'active', vip: false, note: 'Imported' });
  const text = (label: string) => ({
    label,
    input: (p: { control: object; value: unknown; readOnly: boolean; onChange: (next: unknown) => void }) => (
      <Input {...p.control} value={String(p.value ?? '')} readOnly={p.readOnly} onChange={(event): void => p.onChange(event.target.value)} />
    ),
  });
  const declared = useDeclaredForm({
    form: FORM,
    fieldSet: FIELD_SET,
    values,
    onChange: (key, value) => setValues((current) => ({ ...current, [key]: value })),
    render: {
      name: text('Name'),
      phone: { ...text('Phone'), hint: 'Mobile or landline.' },
      status: { ...text('Status'), options: [{ value: 'active', label: 'Active' }, { value: 'blocked', label: 'Blocked' }] },
      vip: text('Key account'),
      note: text('Note'),
    },
  });
  controller = declared;
  return (
    <main>
      <h1>New organization</h1>
      <form aria-label="New organization">
        <DeclaredFormProvider declared={declared}>
          <DeclaredFormNotices />
          <DeclaredFormSection section="identity" />
        </DeclaredFormProvider>
      </form>
    </main>
  );
}

describe('a declared form with slots is accessible (T039)', () => {
  it('passes axe with labels, help, a hint, platform controls, a read-only field and an error', async () => {
    const { container } = render(
      <TranslationProvider language="en" initialBundle={BUNDLE} initialFallbackBundle={BUNDLE}>
        <AuthProvider initial={adminSession({ permissions: ['*'] })}>
          <ModulePresenceProvider initial={modulePresence({ present: ['organizations', 'acme_erp'] })}>
            <AdminContributionsProvider entries={[{ moduleId: 'acme_erp', contributions: { fields: [SLOT] } }]}>
              <EffectiveFormsProvider initial={FORMS}>
                <Host />
              </EffectiveFormsProvider>
            </AdminContributionsProvider>
          </ModulePresenceProvider>
        </AuthProvider>
      </TranslationProvider>,
    );
    expect(await screen.findByRole('textbox', { name: 'ERP code' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Key account' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^Status/u })).toBeInTheDocument();
    act(() => {
      controller?.validate();
    });
    expect(screen.getByLabelText(/^Phone/u)).toHaveAccessibleDescription(/This field is required\./u);
    await expectNoAxeViolations(container);
  });
});

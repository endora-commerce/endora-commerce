import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormDefinition } from '@endora-commerce/contracts';
import { FieldInspector } from '../../../../packages/modules/forms/src/admin/components/FieldInspector';
import { LANGUAGE, definition, en, renderForms } from './forms-fixtures';

/**
 * The "Share with integrations" switch of a field (`specs/170-forms-module/` User Story 8, T113;
 * FR-064, contracts/events-and-webhook.md §1): off by default; switching it on marks the field in
 * the draft (frozen into the version at publish); and beside it, tied to it, the disclosure that a
 * shared answer leaves the shop with the event and the webhook and is kept in the webhook delivery
 * records until they are pruned. A field that takes no answer has no switch.
 */

const FORM: FormDefinition = definition({
  sections: [
    {
      id: 's1',
      columns: 1,
      fields: [
        { id: 'f_name', type: 'text', key: 'name' },
        { id: 'f_intro', type: 'content' },
      ],
    },
  ],
  texts: { [LANGUAGE]: { 'fields.f_name.label': 'Name', 'fields.f_intro.content': '<p>Hello</p>' } },
});

function Harness(props: { readonly fieldId?: string; readonly onChange?: (next: FormDefinition) => void }): ReactNode {
  const [draft, setDraft] = useState<FormDefinition>(FORM);
  return (
    <FieldInspector
      definition={draft}
      fieldId={props.fieldId ?? 'f_name'}
      language={LANGUAGE}
      publishedKeys={new Map()}
      onChange={(next) => {
        setDraft(next);
        props.onChange?.(next);
      }}
      onRemove={() => undefined}
    />
  );
}

const nameField = (next: FormDefinition) => next.sections[0]!.fields.find((field) => field.id === 'f_name') as { shareWithIntegrations: boolean };

describe('FieldInspector — Share with integrations (US8)', () => {
  it('is off by default, and switching it on marks the field in the draft', async () => {
    const onChange = vi.fn();
    renderForms(<Harness onChange={onChange} />);
    const share = screen.getByRole('checkbox', { name: en('inspector.share') });
    expect(share).not.toBeChecked();
    expect(nameField(FORM).shareWithIntegrations).toBe(false);

    await userEvent.click(share);
    expect(share).toBeChecked();
    expect(nameField(onChange.mock.calls.at(-1)![0] as FormDefinition).shareWithIntegrations).toBe(true);
  });

  it('discloses, tied to the switch, that a shared answer is kept in the webhook delivery records', () => {
    renderForms(<Harness />);
    const share = screen.getByRole('checkbox', { name: en('inspector.share') });
    const disclosure = en('inspector.shareHint');
    expect(disclosure).toMatch(/webhook/i);
    expect(disclosure).toMatch(/delivery records/i);
    expect(share).toHaveAccessibleDescription(disclosure);
  });

  it('offers no switch on a field that takes no answer', () => {
    renderForms(<Harness fieldId="f_intro" />);
    expect(screen.queryByRole('checkbox', { name: en('inspector.share') })).toBeNull();
  });
});

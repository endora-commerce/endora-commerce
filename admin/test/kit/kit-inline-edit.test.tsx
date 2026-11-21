import { describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement, type ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Input } from '@endora-commerce/admin-kit/ui';
import { InlineEdit, InlineEditTitle } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1453 (UX audit 2026-11-17, DS-21) and #1525 (WORK-03) — one way to
 * edit a fact of a record: CRM's per-field `InlineEdit`, moved into the kit
 * (owner decision DEC-05), and its header form `InlineEditTitle`. Asserted
 * against the kit's **shipped** `core` copy, in English and Polish, so a key
 * the kit names and the bundle lacks fails here instead of rendering
 * `core.common.inlineEdit.edit` on screen.
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');

function TextFact(props: {
  save: (draft: string) => Promise<void>;
  canEdit?: boolean;
  validate?: (draft: string) => string | null;
  initial?: string;
}): ReactElement {
  const [value, setValue] = useState(props.initial ?? 'Warsaw');
  return (
    <InlineEdit<string>
      label="City"
      canEdit={props.canEdit ?? true}
      display={value}
      initial={(): string => value}
      unchanged={(draft): boolean => draft === value}
      {...(props.validate ? { validate: props.validate } : {})}
      save={async (draft): Promise<void> => {
        await props.save(draft);
        setValue(draft);
      }}
      editor={({ id, draft, setDraft, busy, errorId }): ReactNode => (
        <Input
          id={id}
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

describe('InlineEdit — one fact edited where it is shown', () => {
  it('idle: the value and an always-visible pencil named after the field', () => {
    renderWithI18n(<TextFact save={vi.fn()} />, EN);
    expect(screen.getByText('City')).toBeInTheDocument();
    expect(screen.getByText('Warsaw')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit City' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says "Edit" and "saved" in Polish from the shipped bundle', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderWithI18n(<TextFact save={save} />, PL);
    await userEvent.click(screen.getByRole('button', { name: 'Edytuj: City' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'City' }), 'x{Enter}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Zapisano: City.'));
  });

  it('opens with the focus in the control, saves on Enter, announces it and returns the focus to the pencil', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderWithI18n(<TextFact save={save} />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }));
    const field = screen.getByRole('textbox', { name: 'City' });
    expect(field).toHaveFocus();
    await userEvent.clear(field);
    await userEvent.type(field, 'Gdańsk{Enter}');
    expect(save).toHaveBeenCalledWith('Gdańsk');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit City' })).toHaveFocus());
    expect(screen.getByText('Gdańsk')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('City saved.');
  });

  it('Escape cancels, sends nothing and returns the focus to the pencil', async () => {
    const save = vi.fn();
    renderWithI18n(<TextFact save={save} />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'City' }), 'zzz');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit City' })).toHaveFocus());
  });

  it('an unchanged draft closes without a request', async () => {
    const save = vi.fn();
    renderWithI18n(<TextFact save={save} />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('refuses an invalid draft before anything is sent, the sentence tied to the control', async () => {
    const save = vi.fn();
    renderWithI18n(<TextFact save={save} validate={(draft) => (draft.trim() ? null : 'Name a city.')} />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }));
    const field = screen.getByRole('textbox', { name: 'City' });
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Name a city.');
  });

  it('a refused save keeps the draft and says why; with no sentence of its own, the kit says it', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('That city is not served.')).mockRejectedValueOnce(new Error(''));
    renderWithI18n(<TextFact save={save} />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }));
    const field = screen.getByRole('textbox', { name: 'City' });
    await userEvent.type(field, 'x{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('That city is not served.');
    expect(field).toHaveValue('Warsawx');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.core!['common.inlineEdit.error']!);
  });

  it('holds the control and marks Save busy while the request is in flight', async () => {
    let finish: () => void = () => undefined;
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderWithI18n(<TextFact save={save} />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'City' }), 'x{Enter}');
    const busy = screen.getByRole('button', { name: 'Saving…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('textbox', { name: 'City' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('without permission it is read and nothing more', () => {
    renderWithI18n(<TextFact save={vi.fn()} canEdit={false} />, EN);
    expect(screen.getByText('Warsaw')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('`group`: a group of controls is named by the label through aria-labelledby, not a <label for>', async () => {
    renderWithI18n(
      <InlineEdit<string>
        label="Who sees it"
        group
        canEdit
        display="Everyone"
        initial={(): string => 'everyone'}
        save={vi.fn()}
        editor={({ id, labelId, draft, setDraft }): ReactNode => (
          <div role="radiogroup" aria-labelledby={labelId}>
            {['everyone', 'members'].map((choice) => (
              <label key={choice}>
                <input
                  type="radio"
                  name="who"
                  {...(draft === choice ? { id } : {})}
                  checked={draft === choice}
                  onChange={(): void => setDraft(choice)}
                />
                {choice}
              </label>
            ))}
          </div>
        )}
      />,
      EN,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit Who sees it' }));
    const group = screen.getByRole('radiogroup', { name: 'Who sees it' });
    // The focus is on the chosen option, as a radio group's is.
    expect(within(group).getByRole('radio', { name: 'everyone' })).toHaveFocus();
    expect(document.querySelector('label[for]')).toBeNull();
  });

  it('has no axe violations idle, editing and refused', async () => {
    const save = vi.fn().mockRejectedValue(new Error('No.'));
    const { container } = renderWithI18n(<TextFact save={save} />, EN);
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Edit City' }));
    await expectNoAxeViolations(container);
    await userEvent.type(screen.getByRole('textbox', { name: 'City' }), 'x{Enter}');
    await screen.findByRole('alert');
    await expectNoAxeViolations(container);
  });
});

function Title(props: { save: (draft: string) => Promise<void>; canEdit?: boolean }): ReactElement {
  const [value, setValue] = useState('Order the racking');
  return (
    <MemoryRouter>
      <InlineEditTitle
        label="Title"
        value={value}
        canEdit={props.canEdit ?? true}
        maxLength={200}
        validate={(draft): string | null => (draft === '' ? 'Give it a title.' : null)}
        beside={<span>Open</span>}
        back={{ label: 'All tasks', to: '/tasks' }}
        description="TSK-7"
        save={async (draft): Promise<void> => {
          await props.save(draft);
          setValue(draft);
        }}
      />
    </MemoryRouter>
  );
}

describe('InlineEditTitle — the page title edited where it is read', () => {
  it('idle: the page header, its h1 the title alone, with a pencil beside it', () => {
    renderWithI18n(<Title save={vi.fn()} />, EN);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Order the rackingOpen');
    expect(screen.getByRole('button', { name: 'Edit Title' }).closest('h1')).toBeNull();
    expect(screen.getByText('TSK-7')).toBeInTheDocument();
  });

  it('editing keeps an h1 for assistive technology and saves the trimmed title on Enter', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderWithI18n(<Title save={save} />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
    const field = screen.getByRole('textbox', { name: 'Title' });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('maxlength', '200');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Order the racking');
    await userEvent.clear(field);
    await userEvent.type(field, '  Order the bolts  {Enter}');
    expect(save).toHaveBeenCalledWith('Order the bolts');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Title' })).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Title saved.');
  });

  it('refuses an empty title without a request; Escape cancels', async () => {
    const save = vi.fn();
    renderWithI18n(<Title save={save} />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
    const field = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(field);
    await userEvent.keyboard('{Enter}');
    expect(field).toHaveAccessibleDescription('Give it a title.');
    expect(save).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Title' })).toHaveFocus());
  });

  it('without permission there is no pencil', () => {
    renderWithI18n(<Title save={vi.fn()} canEdit={false} />, EN);
    expect(screen.queryByRole('button', { name: 'Edit Title' })).toBeNull();
  });

  it('has no axe violations idle and editing', async () => {
    const { container } = renderWithI18n(<Title save={vi.fn()} />, EN);
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
    await expectNoAxeViolations(container);
  });
});

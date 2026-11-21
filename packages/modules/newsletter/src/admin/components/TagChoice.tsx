import { useId, type ReactNode } from 'react';
import type { NewsletterTag } from '@endora-commerce/contracts';
import { Checkbox, FormField } from '@endora-commerce/admin-kit/ui';
import { cn } from '@endora-commerce/admin-kit/lib';

export interface TagChoiceProps {
  /** `one` — a single tag, as radios; `many` — any of several, as checkboxes. */
  mode: 'one' | 'many';
  label: ReactNode;
  tags: readonly Pick<NewsletterTag, 'id' | 'name'>[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * The tags a campaign is sent to, or an automation is triggered by (issue
 * #1533, UX audit CONTENT-15). A single tag is a radio group, because a choice
 * of one is a radio everywhere else (Jakob's Law); a list of tags is
 * checkboxes. Each option is a whole `<label>`, so the row is the target, not
 * the 16-pixel box (Fitts's Law).
 */
export function TagChoice({ mode, label, tags, value, onChange, disabled = false }: TagChoiceProps): ReactNode {
  const name = useId();
  return (
    <FormField label={label} group>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {tags.map((tag) => {
          const checked = value.includes(tag.id);
          return (
            <label key={tag.id} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
              {mode === 'one' ? (
                <input
                  type="radio"
                  name={name}
                  value={tag.id}
                  checked={checked}
                  onChange={() => onChange([tag.id])}
                  disabled={disabled}
                  className={cn(
                    'h-4 w-4 shrink-0 border border-input accent-primary',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                />
              ) : (
                <Checkbox
                  checked={checked}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...value, tag.id] : value.filter((id) => id !== tag.id))
                  }
                  disabled={disabled}
                />
              )}
              {tag.name}
            </label>
          );
        })}
      </div>
    </FormField>
  );
}

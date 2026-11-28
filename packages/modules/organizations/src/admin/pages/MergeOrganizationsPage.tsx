import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { OrganizationPicker } from '@endora-commerce/admin-kit/components';
import { Button, Card, CardContent, Label, PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { OrganizationMergeFlow } from '../merge/OrganizationMergeFlow.js';

/**
 * *Merge organizations* (`specs/192-organization-merge/` FR-082;
 * `contracts/organization-merge.md` §5) — the ⌘K action's screen, for an
 * operator who starts from the task rather than from an organization's page:
 * choose the organization to keep, then the same flow the organization's page
 * opens. On a start the merge's progress opens.
 */
export function MergeOrganizationsPage(): ReactNode {
  const own = useTranslation('organizations');
  const navigate = useNavigate();
  const pickerId = useId();
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [survivor, setSurvivor] = useState<{ id: string; name: string } | null>(null);

  const next = async (): Promise<void> => {
    if (survivorId === null) return;
    let name = '';
    try {
      const res = await apiClient.get<{ data?: { name?: string } }>(`/api/v1/admin/organizations/${survivorId}`);
      name = typeof res.data?.name === 'string' ? res.data.name : '';
    } catch {
      // The flow names the organization to keep generically; the preview and the start check it.
    }
    setSurvivor({ id: survivorId, name: name.length > 0 ? name : own('merge.flow.theSurvivor') });
  };

  return (
    <>
      <PageHeader
        back={{ label: own('merge.palettePage.back'), to: '/organizations' }}
        title={own('merge.palettePage.title')}
        actions={
          <Button asChild variant="outline">
            <Link to="/organizations/merges">{own('merge.list.title')}</Link>
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
                <OrganizationPicker
                  id={pickerId}
                  ariaLabel={own('merge.palettePage.picker')}
                  kind="company"
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
            <OrganizationMergeFlow
              survivorId={survivor.id}
              survivorName={survivor.name}
              onCancel={(): void => setSurvivor(null)}
              onStarted={(merge): void => {
                void navigate(`/organizations/merges/${merge.id}`);
              }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default MergeOrganizationsPage;

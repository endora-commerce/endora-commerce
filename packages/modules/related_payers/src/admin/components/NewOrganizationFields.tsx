import { useEffect, useState, type ReactNode } from 'react';
import type { AdminCreateRequestOrganizationRequest, OrganizationSalesChannelOptionsResponse } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { relatedPayersClient } from '../api.js';

/**
 * The fields of a new Organization the operator creates from `related_payers` (FR-021, FR-023):
 * the tax ID with the company-registry lookup that pre-fills the rest, the registered address and
 * the sales channel — the card's *Create a new payer* and the queue's *Create organization* both.
 */
export interface NewOrganizationValues {
  readonly name: string;
  readonly taxId: string;
  readonly street: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
  readonly salesChannelId: string;
}

export interface NewOrganizationState {
  readonly fields: NewOrganizationValues;
  readonly channels: OrganizationSalesChannelOptionsResponse['data'];
  readonly lookupNote: string | null;
  readonly set: (key: keyof NewOrganizationValues) => (event: { target: { value: string } }) => void;
  readonly lookup: () => Promise<void>;
}

export function useNewOrganizationFields(initial: Partial<NewOrganizationValues> = {}): NewOrganizationState {
  const t = useTranslation('related_payers');
  const [channels, setChannels] = useState<OrganizationSalesChannelOptionsResponse['data']>([]);
  const [fields, setFields] = useState<NewOrganizationValues>({
    name: '',
    taxId: '',
    street: '',
    city: '',
    postalCode: '',
    country: 'PL',
    salesChannelId: '',
    ...initial,
  });
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<OrganizationSalesChannelOptionsResponse>('/api/v1/admin/organizations/sales-channel-options')
      .then((res) => {
        if (cancelled) return;
        setChannels(res.data);
        setFields((f) => (f.salesChannelId || !res.data[0] ? f : { ...f, salesChannelId: res.data[0].id }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: keyof NewOrganizationValues) => (event: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: event.target.value }));

  const lookup = async () => {
    setLookupNote(null);
    try {
      const res = await relatedPayersClient.registryLookup(fields.taxId, fields.country);
      const company = res.data.company;
      if (res.data.status !== 'found' || !company) {
        setLookupNote(t('panel.create.lookup.notFound'));
        return;
      }
      setFields((f) => ({
        ...f,
        name: company.legalName ?? f.name,
        street: company.registeredAddress.street ?? f.street,
        city: company.registeredAddress.city ?? f.city,
        postalCode: company.registeredAddress.postalCode ?? f.postalCode,
        country: company.registeredAddress.country,
        taxId: res.data.normalizedTaxId ?? f.taxId,
      }));
      setLookupNote(t('panel.create.lookup.found'));
    } catch {
      setLookupNote(t('panel.create.lookup.unavailable'));
    }
  };

  return { fields, channels, lookupNote, set, lookup };
}

/** The Organization the create routes take, from the fields. */
export function newOrganizationBody(fields: NewOrganizationValues): AdminCreateRequestOrganizationRequest['organization'] {
  return {
    name: fields.name,
    taxId: fields.taxId,
    registeredAddress: { street: fields.street, city: fields.city, postalCode: fields.postalCode, country: fields.country },
    salesChannelIds: [fields.salesChannelId],
  };
}

/** The tax ID with its lookup, the name, the registered address and the sales channel. */
export function NewOrganizationFields({ id, state }: { id: string; state: NewOrganizationState }): ReactNode {
  const t = useTranslation('related_payers');
  const { fields, channels, lookupNote, set, lookup } = state;
  const text = (key: keyof NewOrganizationValues, label: string) => (
    <div className="grid gap-1">
      <Label htmlFor={`${id}-${key}`}>{t(label)}</Label>
      <Input id={`${id}-${key}`} value={fields[key]} onChange={set(key)} required />
    </div>
  );
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        {text('taxId', 'panel.field.taxId')}
        <Button type="button" size="sm" variant="outline" onClick={() => void lookup()} disabled={!fields.taxId.trim()}>
          {t('panel.create.lookup')}
        </Button>
      </div>
      {lookupNote ? <p className="text-xs text-muted-foreground">{lookupNote}</p> : null}
      {text('name', 'panel.field.name')}
      {text('street', 'panel.field.street')}
      {text('city', 'panel.field.city')}
      {text('postalCode', 'panel.field.postalCode')}
      {text('country', 'panel.field.country')}
      <div className="grid gap-1">
        <Label htmlFor={`${id}-channel`}>{t('panel.field.salesChannel')}</Label>
        <Select id={`${id}-channel`} value={fields.salesChannelId} onChange={set('salesChannelId')} required>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.code}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  GaCustomEventCreate,
  GaCustomEventField,
  GaCustomEventResponse,
  GaCustomEventUpdate,
  GaTriggerAction,
} from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { googleAnalyticsClient, type GaActionCatalogue } from '../api/google-analytics-client.js';

const ACTIONS: GaTriggerAction[] = [
  'contact_form_submitted',
  'place_order_clicked',
  'add_to_cart',
  'add_to_quote_request',
  'add_to_shopping_list',
  'button_click_by_id',
];

interface DynamicRow {
  fieldKey: string;
  payloadKey: string;
}

export default function CustomEventEditPage(): ReactNode {
  const t = useTranslation('google_analytics');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isCreate = id === 'new' || id === undefined;

  const [catalogue, setCatalogue] = useState<GaActionCatalogue | null>(null);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  const [eventName, setEventName] = useState('');
  const [triggerAction, setTriggerAction] = useState<GaTriggerAction>('add_to_cart');
  const [buttonId, setButtonId] = useState('');
  const [channelCode, setChannelCode] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [staticSelected, setStaticSelected] = useState<Set<string>>(new Set());
  const [dynamicRows, setDynamicRows] = useState<DynamicRow[]>([]);

  const staticFields = useMemo(
    () => catalogue?.[triggerAction]?.static ?? null,
    [catalogue, triggerAction],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cat = await googleAnalyticsClient.actionCatalogue();
        if (cancelled) return;
        setCatalogue(cat);
        if (!isCreate) {
          const ev = await googleAnalyticsClient.get(id!);
          if (cancelled) return;
          hydrate(ev, cat);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.envelope.error.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function hydrate(ev: GaCustomEventResponse, cat: GaActionCatalogue): void {
    setEventName(ev.eventName);
    setTriggerAction(ev.triggerAction);
    setButtonId(ev.buttonId ?? '');
    setChannelCode(ev.salesChannelCode ?? '');
    setEnabled(ev.enabled);
    setVersion(ev.version);
    const isStatic = cat[ev.triggerAction]?.static !== null;
    if (isStatic) {
      setStaticSelected(new Set(ev.fields.map((f) => f.fieldKey)));
    } else {
      setDynamicRows(ev.fields.map((f) => ({ fieldKey: f.fieldKey, payloadKey: f.payloadKey ?? '' })));
    }
  }

  function buildFields(): GaCustomEventField[] {
    if (staticFields !== null) {
      return staticFields
        .filter((k) => staticSelected.has(k))
        .map((fieldKey, position) => ({ fieldKey, position }));
    }
    return dynamicRows
      .filter((r) => r.fieldKey.trim())
      .map((r, position) => ({
        fieldKey: r.fieldKey.trim(),
        position,
        ...(r.payloadKey.trim() ? { payloadKey: r.payloadKey.trim() } : {}),
      }));
  }

  const save = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const fields = buildFields();
      const isButton = triggerAction === 'button_click_by_id';
      if (isCreate) {
        const body: GaCustomEventCreate = {
          eventName,
          triggerAction,
          enabled,
          fields,
          ...(channelCode.trim() ? { salesChannelCode: channelCode.trim() } : {}),
          ...(isButton ? { buttonId: buttonId.trim() } : {}),
        };
        await googleAnalyticsClient.create(body);
      } else {
        const body: GaCustomEventUpdate = {
          eventName,
          triggerAction,
          enabled,
          fields,
          version: version ?? 1,
          salesChannelCode: channelCode.trim() ? channelCode.trim() : null,
          buttonId: isButton ? buttonId.trim() : null,
        };
        await googleAnalyticsClient.update(id!, body);
      }
      navigate('/google-analytics');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : String(err));
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    eventName,
    triggerAction,
    enabled,
    channelCode,
    buttonId,
    version,
    id,
    isCreate,
    staticSelected,
    dynamicRows,
    staticFields,
  ]);

  const remove = useCallback(async (): Promise<void> => {
    if (isCreate) return;
    setSaving(true);
    try {
      await googleAnalyticsClient.remove(id!);
      navigate('/google-analytics');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : String(err));
      setSaving(false);
    }
  }, [id, isCreate, navigate]);

  if (loading) return <p className="p-6 text-muted-foreground">…</p>;

  return (
    <>
      <PageHeader title={isCreate ? t('customEvents.new') : t('customEvents.edit')} />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ga-name">{t('customEvents.eventName')}</Label>
            <Input id="ga-name" value={eventName} onChange={(e) => setEventName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="ga-action">{t('customEvents.triggerAction')}</Label>
            <Select
              id="ga-action"
              value={triggerAction}
              onChange={(e) => {
                setTriggerAction(e.target.value as GaTriggerAction);
                setStaticSelected(new Set());
                setDynamicRows([]);
              }}
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`customEvents.actions.${a}`)}
                </option>
              ))}
            </Select>
          </div>

          {triggerAction === 'button_click_by_id' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="ga-button">{t('customEvents.buttonId')}</Label>
              <Input id="ga-button" value={buttonId} onChange={(e) => setButtonId(e.target.value)} />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="ga-channel">{t('customEvents.salesChannel')}</Label>
            <Input
              id="ga-channel"
              value={channelCode}
              placeholder={t('customEvents.allChannels')}
              onChange={(e) => setChannelCode(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="ga-enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <Label htmlFor="ga-enabled" className="cursor-pointer">
              {t('customEvents.enabled')}
            </Label>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('customEvents.fields')}</Label>
            {staticFields !== null ? (
              <div className="flex flex-col gap-2">
                {staticFields.map((key) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      id={`ga-field-${key}`}
                      checked={staticSelected.has(key)}
                      onChange={(e) => {
                        const next = new Set(staticSelected);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        setStaticSelected(next);
                      }}
                    />
                    <span>{key}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">{t('customEvents.fieldsHint')}</p>
                {dynamicRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder={t('customEvents.fieldKey')}
                      value={row.fieldKey}
                      onChange={(e) => {
                        const next = [...dynamicRows];
                        next[i] = { ...row, fieldKey: e.target.value };
                        setDynamicRows(next);
                      }}
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t('customEvents.sentAs')}
                    </span>
                    <Input
                      placeholder={t('customEvents.payloadKeyHint')}
                      value={row.payloadKey}
                      onChange={(e) => {
                        const next = [...dynamicRows];
                        next[i] = { ...row, payloadKey: e.target.value };
                        setDynamicRows(next);
                      }}
                    />
                    <Button
                      variant="ghost"
                      onClick={() => setDynamicRows(dynamicRows.filter((_, j) => j !== i))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() => setDynamicRows([...dynamicRows, { fieldKey: '', payloadKey: '' }])}
                >
                  {t('customEvents.addField')}
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={() => void save()} disabled={saving}>
              {t('customEvents.save')}
            </Button>
            {!isCreate && (
              <Button variant="destructive" onClick={() => void remove()} disabled={saving}>
                {t('customEvents.delete')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

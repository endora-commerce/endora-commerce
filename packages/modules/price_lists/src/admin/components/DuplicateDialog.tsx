import { useEffect, useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy } from 'lucide-react';
import type { PriceBook, PriceBookAudienceKind, PriceBookTargetCurrency, PriceBookTargetSalesChannel } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { errorMessage } from '../lib/api-errors.js';
import { parseFactor } from '../lib/bulk.js';
import { useLocalizedName } from '../lib/localized-name.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';
import { AudienceField } from './AudienceField.js';
import { ChannelsField } from './ChannelsField.js';

/**
 * Duplicating a book (feature 161, US4 — FR-022): a new draft with the
 * source's rows, built from a dialog pre-filled with the source's name
 * ("… (copy)"), channels, currency and audience and a multiplier of 1. A
 * changed currency flags every chosen channel that does not sell in it before
 * anything is sent; the multiplier converts fixed prices and amount
 * adjustments, half-up to 4 places on the server, and copies percentages
 * unchanged. The source is never written.
 */
export function DuplicateDialog(props: {
  readonly book: PriceBook;
  readonly channels: readonly PriceBookTargetSalesChannel[];
  readonly kinds: readonly PriceBookAudienceKind[];
  readonly onClose: () => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const navigate = useNavigate();
  const localizedName = useLocalizedName();
  const id = useId();
  const { book } = props;
  const [name, setName] = useState(t('duplicate.copyName', { name: book.name }));
  const [currency, setCurrency] = useState(book.currencyCode);
  const [currencies, setCurrencies] = useState<PriceBookTargetCurrency[]>([]);
  const [channelIds, setChannelIds] = useState<string[]>(book.channels.map((c) => c.channelId));
  const [kind, setKind] = useState<PriceBookAudienceKind>(book.audience.kind);
  const [memberIds, setMemberIds] = useState<string[]>([...book.audience.memberIds]);
  const [multiplier, setMultiplier] = useState('1');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.targets.currencies().then(setCurrencies).catch(() => undefined);
  }, [api]);

  /** Chosen channels that do not sell in the chosen currency. */
  const foreign = props.channels.filter((c) => channelIds.includes(c.id) && !c.currencies.includes(currency));
  const kinds = props.kinds.includes(book.audience.kind) ? props.kinds : [book.audience.kind, ...props.kinds];

  const submit = async (): Promise<void> => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found['name'] = t('priceBooks.validation.nameRequired');
    const factor = parseFactor(multiplier);
    if (factor === null) found['multiplier'] = t('duplicate.multiplierInvalid');
    setErrors(found);
    if (Object.keys(found).length > 0 || foreign.length > 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      const copy = await api.duplicate(book.id, {
        name: name.trim(),
        channelIds,
        currencyCode: currency,
        audience: { kind, memberIds: kind === 'everyone' ? [] : memberIds },
        amountMultiplier: multiplier.trim().replace(',', '.'),
      });
      void navigate(`/price-lists/${copy.id}`);
      props.onClose();
    } catch (err) {
      setRefusal(errorMessage(err, t('duplicate.error')));
      setBusy(false);
    }
  };

  const invalid = (key: string) => (errors[key] ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-${key}-error ${id}-${key}-help` } : { 'aria-describedby': `${id}-${key}-help` });

  return (
    <ModalDialog
      title={t('duplicate.title')}
      onClose={props.onClose}
      busy={busy}
      footer={
        <>
          <Button type="button" variant="outline" onClick={props.onClose} disabled={busy}>
            {t('priceBooks.common.cancel')}
          </Button>
          <Button type="button" onClick={(): void => void submit()} disabled={busy} aria-busy={busy}>
            <Copy aria-hidden="true" />
            {t('duplicate.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {refusal ? (
          <Alert variant="destructive">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={`${id}-name`}>{t('priceBooks.field.name')}</Label>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={200}
            onChange={(event): void => setName(event.target.value)}
            {...(errors['name'] ? { 'aria-invalid': true, 'aria-describedby': `${id}-name-error` } : {})}
          />
          {errors['name'] ? (
            <p id={`${id}-name-error`} className="text-xs text-destructive">
              {errors['name']}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-currency`}>{t('priceBooks.field.currency')}</Label>
          <Select id={`${id}-currency`} value={currency} onChange={(event): void => setCurrency(event.target.value)}>
            {[...new Set([book.currencyCode, ...currencies.map((c) => c.code)])].sort().map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>
        <ChannelsField currency={currency} channels={props.channels} value={channelIds} onChange={setChannelIds} />
        {foreign.map((channel) => (
          <p key={channel.id} className="text-xs text-destructive">
            {t('duplicate.foreignChannel', { channel: localizedName(channel.name, channel.code), currency })}
          </p>
        ))}
        <AudienceField
          kinds={kinds}
          kind={kind}
          onKindChange={(next): void => {
            setKind(next);
            setMemberIds([]);
          }}
          kindFixed={false}
          memberIds={memberIds}
          onMembersChange={setMemberIds}
        />
        <div className="space-y-1">
          <Label htmlFor={`${id}-multiplier`}>{t('duplicate.multiplier')}</Label>
          <Input
            id={`${id}-multiplier`}
            inputMode="decimal"
            className="max-w-40"
            value={multiplier}
            onChange={(event): void => setMultiplier(event.target.value)}
            {...invalid('multiplier')}
          />
          <p id={`${id}-multiplier-help`} className="text-xs text-muted-foreground">
            {t('duplicate.multiplierHelp')}
          </p>
          {errors['multiplier'] ? (
            <p id={`${id}-multiplier-error`} className="text-xs text-destructive">
              {errors['multiplier']}
            </p>
          ) : null}
        </div>
      </div>
    </ModalDialog>
  );
}

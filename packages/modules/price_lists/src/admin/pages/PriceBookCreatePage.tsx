import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type {
  PriceBookAudienceKind,
  PriceBookTargetCurrency,
  PriceBookTargetSalesChannel,
  PriceBookType,
} from '@endora-commerce/contracts';
import { StickyFormActions } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Input, Label, PageHeader } from '@endora-commerce/admin-kit/ui';
import { AudienceField } from '../components/AudienceField.js';
import { ChannelsField } from '../components/ChannelsField.js';
import { ScheduleFields, parseSchedule, type ScheduleDraft } from '../components/ScheduleFields.js';
import { errorMessage, errorPaths } from '../lib/api-errors.js';
import { BOOK_TYPES, typeHelp, typeLabel } from '../lib/book-labels.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * The create flow (feature 161, US1 — FR-002, FR-033; `research.md` R3).
 *
 * Five steps in the order the spec fixes — name and type, currency, sales
 * channels, audience, schedule and priority — because each narrows the next:
 * the channels offered are those selling in the currency, the audience kinds
 * those the caller may create (G11). Progress is stated as text ("Step 2 of
 * 5"), each step has one primary action, and *Back* keeps every answer. The
 * book is created as a **draft** and opened; activating it is the header's
 * job, where a missing channel or member is explained.
 *
 * A refusal from the server is mapped back to the step that owns the field it
 * names (`details[].path`), with the server's own sentence.
 */

const STEPS = ['type', 'currency', 'channels', 'audience', 'schedule'] as const;
type Step = (typeof STEPS)[number];

/** The step that owns a request path the server refuses. */
function stepOf(path: string): Step {
  if (path.startsWith('currencyCode')) return 'currency';
  if (path.startsWith('channelIds')) return 'channels';
  if (path.startsWith('audience')) return 'audience';
  if (path.startsWith('startsAt') || path.startsWith('endsAt') || path.startsWith('priority')) return 'schedule';
  return 'type';
}

export function PriceBookCreatePage(): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const navigate = useNavigate();
  const nameId = useId();
  const typeName = useId();
  const currencyName = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const [step, setStep] = useState<Step>('type');
  const [name, setName] = useState('');
  const [type, setType] = useState<PriceBookType>('regular');
  const [currency, setCurrency] = useState<string | null>(null);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [kinds, setKinds] = useState<PriceBookAudienceKind[]>([]);
  const [kind, setKind] = useState<PriceBookAudienceKind>('everyone');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<ScheduleDraft>({ startsAt: '', endsAt: '', priority: '0' });
  const [currencies, setCurrencies] = useState<PriceBookTargetCurrency[]>([]);
  const [channels, setChannels] = useState<PriceBookTargetSalesChannel[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);

  const touched = name !== '' || currency !== null || channelIds.length > 0 || memberIds.length > 0;
  useUnsavedChangesPrompt(touched && !created);

  // The currencies are the step's only choices: their loading and failure are
  // said, with a retry (T096, FR-032).
  const [currenciesState, setCurrenciesState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const loadCurrencies = useCallback((): void => {
    setCurrenciesState('loading');
    api.targets.currencies().then(
      (answer) => {
        setCurrencies(answer);
        setCurrenciesState('ready');
      },
      () => setCurrenciesState('failed'),
    );
  }, [api]);

  useEffect(() => {
    loadCurrencies();
    void api.targets.salesChannels().then(setChannels).catch(() => undefined);
    // The kinds the caller may create are the list's `meta` (G11).
    void api
      .list({ page: 1, pageSize: 1 })
      .then((answer) => {
        const creatable = answer.meta.creatableAudienceKinds;
        setKinds(creatable);
        setKind((current) => (creatable.includes(current) ? current : (creatable[0] ?? current)));
      })
      .catch(() => undefined);
  }, [api, loadCurrencies]);

  const index = STEPS.indexOf(step);
  const go = (next: Step): void => {
    setStep(next);
    // The step's heading takes focus, so a screen reader hears where it is.
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  /** The current step's own checks; `true` when it may be left forwards. */
  const validate = (): boolean => {
    const found: Record<string, string> = {};
    if (step === 'type' && name.trim() === '') found['name'] = t('priceBooks.validation.nameRequired');
    if (step === 'currency' && !currency) found['currency'] = t('priceBooks.validation.currencyRequired');
    if (step === 'schedule') Object.assign(found, parseSchedule(schedule, t).errors);
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const next = (): void => {
    if (!validate()) return;
    setRefusal(null);
    go(STEPS[index + 1]!);
  };

  const submit = async (): Promise<void> => {
    if (!validate() || !currency) return;
    const parsed = parseSchedule(schedule, t);
    setSubmitting(true);
    setRefusal(null);
    try {
      const book = await api.create({
        name: name.trim(),
        type,
        currencyCode: currency,
        channelIds,
        audience: { kind, memberIds: kind === 'everyone' ? [] : memberIds },
        priority: parsed.priority,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
      });
      setCreated(true);
      void navigate(`/price-lists/${book.id}`);
    } catch (err) {
      const paths = errorPaths(err);
      setRefusal(errorMessage(err, t('priceBooks.create.error')));
      if (paths.length > 0) go(stepOf(paths[0]!));
      setSubmitting(false);
    }
  };

  const offering = (code: string): string =>
    currencies.find((c) => c.code === code)?.exposedByChannels.join(', ') ?? '';

  return (
    <>
      <PageHeader
        title={t('priceBooks.create.title')}
        description={t('priceBooks.create.description')}
        back={{ label: t('priceBooks.common.backToList'), to: '/price-lists' }}
      />
      <section className="max-w-2xl space-y-4" aria-labelledby={`${nameId}-heading`}>
        <h2 id={`${nameId}-heading`} ref={headingRef} tabIndex={-1} className="text-lg font-semibold focus-visible:outline-none">
          {t('priceBooks.create.progress', { step: index + 1, total: STEPS.length, name: t(`priceBooks.create.step.${step}`) })}
        </h2>
        <ol className="flex gap-1" aria-hidden="true">
          {STEPS.map((s, i) => (
            <li key={s} className={`h-1 flex-1 rounded ${i <= index ? 'bg-primary/70' : 'bg-muted'}`} />
          ))}
        </ol>

        {refusal ? (
          <Alert variant="destructive">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        ) : null}

        {step === 'type' ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor={nameId}>{t('priceBooks.field.name')}</Label>
              <Input
                id={nameId}
                value={name}
                maxLength={200}
                aria-invalid={errors['name'] ? true : undefined}
                aria-describedby={errors['name'] ? `${nameId}-error` : undefined}
                onChange={(event): void => setName(event.target.value)}
              />
              {errors['name'] ? (
                <p id={`${nameId}-error`} className="text-xs text-destructive">
                  {errors['name']}
                </p>
              ) : null}
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t('priceBooks.field.type')}</legend>
              {BOOK_TYPES.map((value) => (
                <label key={value} className="flex min-h-11 items-start gap-2 text-sm sm:min-h-8">
                  <input
                    type="radio"
                    name={typeName}
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={type === value}
                    onChange={(): void => setType(value)}
                  />
                  <span>
                    <span className="font-medium">{typeLabel(t, value)}</span>
                    <span className="block text-xs text-muted-foreground">{typeHelp(t, value)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        ) : null}

        {step === 'currency' ? (
          <fieldset className="space-y-1" aria-describedby={errors['currency'] ? `${currencyName}-error` : undefined}>
            <legend className="text-sm font-medium">{t('priceBooks.field.currency')}</legend>
            <p className="text-xs text-muted-foreground">{t('priceBooks.create.currencyHelp')}</p>
            {currenciesState === 'loading' ? (
              <div aria-busy="true" className="space-y-2">
                <p className="sr-only">{t('priceBooks.create.currenciesLoading')}</p>
                {[0, 1].map((i) => (
                  <div key={i} className="h-8 rounded bg-muted motion-safe:animate-pulse" aria-hidden="true" />
                ))}
              </div>
            ) : null}
            {currenciesState === 'failed' ? (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t('priceBooks.create.currenciesError')}</span>
                  <Button type="button" variant="outline" size="sm" onClick={loadCurrencies}>
                    <RotateCcw aria-hidden="true" />
                    {t('priceBooks.common.retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {currencies.map((c) => (
              <label key={c.code} className="flex min-h-11 items-start gap-2 text-sm sm:min-h-8">
                <input
                  type="radio"
                  name={currencyName}
                  className="mt-1 h-4 w-4 accent-primary"
                  checked={currency === c.code}
                  onChange={(): void => {
                    if (currency !== c.code) setChannelIds([]);
                    setCurrency(c.code);
                  }}
                />
                <span>
                  <span className="font-medium">{c.code}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('priceBooks.create.currencyOfferedBy', { channels: offering(c.code) })}
                  </span>
                </span>
              </label>
            ))}
            {errors['currency'] ? (
              <p id={`${currencyName}-error`} className="text-xs text-destructive">
                {errors['currency']}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {step === 'channels' && currency ? (
          <div className="space-y-2">
            <ChannelsField currency={currency} channels={channels} value={channelIds} onChange={setChannelIds} />
            {channelIds.length === 0 ? <p className="text-xs text-muted-foreground">{t('priceBooks.channels.emptyWarning')}</p> : null}
          </div>
        ) : null}

        {step === 'audience' ? (
          <div className="space-y-2">
            <AudienceField
              kinds={kinds}
              kind={kind}
              onKindChange={(value): void => {
                setKind(value);
                setMemberIds([]);
              }}
              kindFixed={false}
              memberIds={memberIds}
              onMembersChange={setMemberIds}
            />
            {kind !== 'everyone' && memberIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('priceBooks.members.emptyWarning')}</p>
            ) : null}
          </div>
        ) : null}

        {step === 'schedule' ? <ScheduleFields value={schedule} onChange={setSchedule} errors={errors} /> : null}

        <StickyFormActions className="flex flex-wrap justify-between gap-2">
          {index > 0 ? (
            <Button type="button" variant="outline" onClick={(): void => go(STEPS[index - 1]!)} disabled={submitting}>
              {t('priceBooks.create.back')}
            </Button>
          ) : (
            <span />
          )}
          {step === 'schedule' ? (
            <Button type="button" onClick={(): void => void submit()} disabled={submitting} aria-busy={submitting}>
              {submitting ? t('priceBooks.create.creating') : t('priceBooks.create.submit')}
            </Button>
          ) : (
            <Button type="button" onClick={next}>
              {t('priceBooks.create.next')}
            </Button>
          )}
        </StickyFormActions>
      </section>
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default PriceBookCreatePage;

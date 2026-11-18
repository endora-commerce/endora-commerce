import { Fragment, type ReactNode } from 'react';
import type { MessageKey } from '../../lib/i18n/messages';
import { format } from '../../lib/i18n/format';
import { OFF_PLATFORM_FORM_LINES } from '../../lib/returns/returnForm';
import type { AttachmentLimits } from '../../lib/returns/attachments';
import { AttachmentField } from './AttachmentField';
import { LineSlots } from './LineSlots';
import { ProductField } from './ProductField';

/**
 * The product lines of a complaint without an order (`specs/180-off-platform-complaints/`
 * FR-B12; design review R-2.1). One line is the common case; `LineSlots` adds and removes
 * lines 2–5 (nested `<details>` without JavaScript). Each line carries its own defect photos,
 * posted under its slot and tied to that line of the case. The product is one field that
 * searches the catalogue and takes a typed model name (`ProductField`); without JavaScript
 * it is the model name as written on it. A reason that is the only one is chosen already,
 * shown as text with a hidden input. A line whose catalogue product the API refused comes
 * back marked `lines.N.productRefused`, its name kept as a typed model.
 */
export interface OffPlatformReason {
  readonly id: string;
  readonly label: string;
}

export function OffPlatformLines({
  t,
  locale,
  reasons,
  answers,
  errors = [],
  apiBaseUrl = null,
  salesChannelCode,
  limits,
  keptPhotos = {},
}: {
  t: (key: MessageKey) => string;
  locale: string;
  /** The browser's API origin for the catalogue search; `null` keeps the field plain. */
  apiBaseUrl?: string | null;
  salesChannelCode?: string | undefined;
  reasons: readonly OffPlatformReason[];
  /** A refused attempt's typed answers. */
  answers: Record<string, string>;
  errors?: readonly string[];
  limits: AttachmentLimits;
  /** Each slot's photos accepted on a refused attempt, kept by id. */
  keptPhotos?: Readonly<Record<number, ReadonlyArray<{ uploadId: string; filename: string }>>>;
}): ReactNode {
  const line = (i: number): ReactNode => {
    const name = (field: string): string => `lines.${i}.${field}`;
    const id = (field: string): string => `line-${i}-${field}`;
    const value = (field: string): string => answers[name(field)] ?? '';
    // A line the customer started, judged by the refused attempt's answers: its empty
    // required answers are marked where they are, not only in the summary above.
    const started = Boolean(value('modelName') || value('productId') || value('description') || keptPhotos[i]?.length);
    const missing = (code: string, field: string): boolean => started && errors.includes(code) && !value(field);
    const productError =
      errors.includes('unknown_product') && value('productRefused') === '1'
        ? t('returns.errors.unknown_product')
        : i === 0 && errors.includes('no_line')
          ? t('returns.errors.no_line')
          : missing('product_missing', 'modelName') && !value('productId')
            ? t('returns.errors.product_missing')
            : undefined;
    const reasonError = missing('reason_missing', 'reasonId') ? t('returns.errors.reason_missing') : undefined;
    const descriptionError = missing('description_missing', 'description') ? t('returns.errors.description_missing') : undefined;
    return (
      <>
        <ProductField
          id={id('model')}
          namePrefix={`lines.${i}`}
          locale={locale}
          label={t('returns.elsewhere.product')}
          hint={t('returns.elsewhere.productHint')}
          defaultValue={value('modelName')}
          {...(value('productId') ? { defaultProductId: value('productId') } : {})}
          {...(productError ? { error: productError } : {})}
          apiBaseUrl={apiBaseUrl}
          salesChannelCode={salesChannelCode}
        />
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor={id('quantity')}>{t('returns.elsewhere.quantity')}</label>
            <input
              id={id('quantity')}
              name={name('quantity')}
              type="number"
              inputMode="numeric"
              min={1}
              defaultValue={value('quantity') || '1'}
            />
          </div>
          <div className="b2b-auth__field">
            {reasons.length === 1 ? (
              <>
                <span className="b2b-stacked__label">{t('returns.elsewhere.reason')}</span>
                <p>{reasons[0]!.label}</p>
                <input type="hidden" name={name('reasonId')} value={reasons[0]!.id} />
              </>
            ) : (
              <>
                <label htmlFor={id('reason')}>{t('returns.elsewhere.reason')}</label>
                <select
                  id={id('reason')}
                  name={name('reasonId')}
                  required={i === 0}
                  defaultValue={value('reasonId')}
                  {...(reasonError ? { 'aria-invalid': true, 'aria-describedby': `${id('reason')}-error` } : {})}
                >
                  <option value="">{t('returns.elsewhere.chooseReason')}</option>
                  {reasons.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {reasonError ? (
                  <p id={`${id('reason')}-error`} className="b2b-auth__error m-0">
                    {reasonError}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="b2b-auth__field">
          <label htmlFor={id('description')}>{t('returns.elsewhere.description')}</label>
          <textarea
            id={id('description')}
            name={name('description')}
            maxLength={2000}
            rows={4}
            required={i === 0}
            defaultValue={value('description')}
            aria-describedby={`${id('description')}-hint${descriptionError ? ` ${id('description')}-error` : ''}`}
            {...(descriptionError ? { 'aria-invalid': true } : {})}
          />
          <p id={`${id('description')}-hint`} className="text-[12px] text-muted">
            {t('returns.elsewhere.descriptionHint')}
          </p>
          {descriptionError ? (
            <p id={`${id('description')}-error`} className="b2b-auth__error m-0">
              {descriptionError}
            </p>
          ) : null}
        </div>
        <div className="b2b-auth__field">
          <label htmlFor={id('serial')}>{t('returns.elsewhere.serial')}</label>
          <input
            id={id('serial')}
            name={name('serialNumber')}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            defaultValue={value('serialNumber')}
            aria-describedby={`${id('serial')}-hint`}
          />
          <p id={`${id('serial')}-hint`} className="text-[12px] text-muted">
            {t('returns.elsewhere.serialHint')}
          </p>
        </div>
        <AttachmentField
          type="photo"
          locale={locale}
          id={id('photos')}
          line={i}
          label={t('returns.elsewhere.photos')}
          limits={limits}
          kept={keptPhotos[i] ?? []}
        />
      </>
    );
  };

  // A refused attempt reopens every slot up to the last one it carried.
  const slots = Array.from({ length: OFF_PLATFORM_FORM_LINES }, (_, i) => i);
  const used = slots.filter((i) => answers[`lines.${i}.modelName`] || answers[`lines.${i}.description`] || keptPhotos[i]?.length);
  const numbered = slots.map((i) => format(t('returns.elsewhere.productNumbered'), { n: String(i + 1) }));
  return (
    <LineSlots
      slots={slots.map((i) => <Fragment key={i}>{line(i)}</Fragment>)}
      initialCount={used.length > 0 ? Math.max(...used) + 1 : 1}
      addLabel={t('returns.elsewhere.addProduct')}
      removeLabel={t('returns.elsewhere.removeProduct')}
      headings={numbered}
      removeNames={slots.map((i) => format(t('returns.elsewhere.removeProductNamed'), { n: String(i + 1) }))}
    />
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BRAND_SCHEMES,
  BRAND_SPACE_TOKENS,
  BRAND_TYPE_TOKENS,
  assessBrandContrast,
  cmsBrandTokensSchema,
  type BrandScheme,
  type CmsBrandTokens,
  type CmsBrandTokensAdminRead,
  type CmsBrandTokensScope,
  type ContrastFinding,
} from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  ColorPicker,
  Input,
  Label,
  PageHeader,
  SaveButtonGroup,
  Section,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { AssetFieldPicker, SalesChannelPicker, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cmsClient } from '../api/cms-client.js';
import { BrandPreview } from '../components/BrandPreview.js';
import { BrandFontFields } from '../components/BrandFontFields.js';

/** The code a save needs; reading — and opening this screen — is `cms.read`. */
const BRAND_PERMISSION = 'cms.brand';

const NEUTRAL_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
const PALETTE_ROLES = ['primary', 'primaryHover', 'secondary', 'secondaryHover', 'onPrimary', 'onSecondary'] as const;
const SCHEME_FIELDS = ['background', 'text', 'textMuted', 'border', 'link'] as const;
const TYPE_WEIGHTS = [300, 400, 500, 600, 700, 800] as const;
const BUTTON_WEIGHTS = [400, 500, 600, 700] as const;

type Translate = (key: string, params?: Record<string, string | number>) => string;

type Feedback =
  | { kind: 'saved' }
  | { kind: 'reset' }
  | { kind: 'conflict' }
  | { kind: 'invalid'; fields: string }
  | { kind: 'error'; message: string };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.envelope.error.message;
  return err instanceof Error ? err.message : String(err);
}

/** A token path from a contrast finding, in the words the form labels it with. */
function tokenLabel(path: string, t: Translate): string {
  const parts = path.split('.');
  if (parts[0] === 'schemes' && parts.length === 3) {
    return t('brand.schemes.colorLabel', {
      scheme: t(`brand.schemes.${parts[1]}`),
      field: t(`brand.schemeField.${parts[2]}`),
    });
  }
  if (parts[0] === 'colors' && parts.length === 2) return t(`brand.colors.${parts[1]}`);
  if (parts[0] === 'accentGradient' && parts.length === 2) return t(`brand.gradient.${parts[1]}`);
  return path;
}

/**
 * `<foreground>/<background>`; a background with no dot is a sibling of the
 * foreground (`schemes.dark.link/background`), as `assessBrandContrast` writes it.
 */
function describeFinding(finding: ContrastFinding, t: Translate): string {
  const [foreground = '', backgroundRaw = ''] = finding.pair.split('/');
  const background = backgroundRaw.includes('.')
    ? backgroundRaw
    : [...foreground.split('.').slice(0, -1), backgroundRaw].join('.');
  return t('brand.contrast.finding', {
    foreground: tokenLabel(foreground, t),
    background: tokenLabel(background, t),
    ratio: finding.ratio,
    required: finding.required,
  });
}

function ColorField(props: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  disabled: boolean;
}): ReactElement {
  const t = useTranslation('cms');
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium">{props.label}</span>
      <ColorPicker
        label={props.label}
        customLabel={t('brand.customColor', { name: props.label })}
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
      />
    </div>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Hide the visible label (a table cell names its column instead); the input keeps it as its name. */
  labelHidden?: boolean;
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id} className={props.labelHidden ? 'sr-only' : undefined}>
        {props.label}
      </Label>
      <Input
        id={props.id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(props.value) ? String(props.value) : ''}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
        // An empty field stays empty while typing; the save refuses it by name.
        onChange={(e): void => props.onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      />
    </div>
  );
}

/**
 * R20F (T322): an optional factor — empty means 1 and stores nothing. The text
 * typed is kept as it is while typing (so "1." or an empty field never jumps
 * back), and the draft takes the number once it is one.
 */
function FactorField(props: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  disabled: boolean;
  /** R21H: the same field for an optional width in px (defaults: a factor, 0.5–2). */
  min?: number;
  max?: number;
  step?: number;
}): ReactElement {
  const [text, setText] = useState(props.value === undefined ? '' : String(props.value));
  useEffect(() => {
    setText((current) => {
      const parsed = current.trim() === '' ? undefined : Number(current);
      return parsed === props.value ? current : props.value === undefined ? '' : String(props.value);
    });
  }, [props.value]);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type="number"
        inputMode="decimal"
        value={text}
        min={props.min ?? 0.5}
        max={props.max ?? 2}
        step={props.step ?? 0.01}
        disabled={props.disabled}
        onChange={(e): void => {
          setText(e.target.value);
          props.onChange(e.target.value.trim() === '' ? undefined : Number(e.target.value));
        }}
      />
    </div>
  );
}

type TierScale = NonNullable<CmsBrandTokens['tierScale']>;

/**
 * One tier-scale option set or removed; an emptied scale is removed whole, so
 * a brand that never chose one stores nothing. R21H: the fluid end goes with
 * the fluid sizes.
 */
function setTierScale<K extends keyof TierScale>(draft: CmsBrandTokens, key: K, value: TierScale[K] | undefined): void {
  const next: TierScale = { ...(draft.tierScale ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  if (key === 'fluidDesktop' && value === undefined) delete next.fluidUntilPx;
  if (Object.keys(next).length > 0) draft.tierScale = next;
  else delete draft.tierScale;
}

function BrandCard(props: { title: string; description?: string; children: ReactNode }): ReactElement {
  return (
    <Card>
      <CardContent className="pt-6">
        <Section title={props.title}>
          {props.description ? <p className="text-sm text-muted-foreground">{props.description}</p> : null}
          {props.children}
        </Section>
      </CardContent>
    </Card>
  );
}

/**
 * Feature 163 — the brand screen (`specs/163-page-builder-marketing-pages/`
 * FR-006 to FR-006c, contract §1 and §6).
 *
 * One set of tokens globally, and a complete copy per sales channel that
 * overrides it (research R-1): a channel either inherits the global set — shown
 * read-only here, with "Override for this channel" starting a copy of it — or
 * has its own, which later global changes do not reach and which "Reset to
 * global" removes. Contrast below WCAG 2.2 AA is a warning beside the form,
 * never a refusal (FR-006b). Without `cms.brand` the screen is read-only.
 */
export function BrandPage(): ReactNode {
  const t = useTranslation('cms');
  const { confirm, confirmDialog } = useConfirmDialog();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(BRAND_PERMISSION);

  const [channelId, setChannelId] = useState<string | null>(null);
  const [read, setRead] = useState<CmsBrandTokensAdminRead | null>(null);
  const [draft, setDraft] = useState<CmsBrandTokens | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Only the latest read may land: switching channels while one is in flight
  // must not leave the previous channel's set on screen.
  const requestRef = useRef(0);

  const load = useCallback(async (scopeChannelId: string | null): Promise<void> => {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await cmsClient.getBrandTokens(scopeChannelId);
      if (request !== requestRef.current) return;
      setRead(next);
      setDraft(structuredClone(next.effective));
      setOverriding(false);
    } catch (err) {
      if (request === requestRef.current) setLoadError(errorMessage(err));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(channelId);
  }, [channelId, load]);

  const edit = useCallback((mutate: (tokens: CmsBrandTokens) => void): void => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      mutate(next);
      return next;
    });
  }, []);

  const channelState = channelId !== null && read?.channel?.salesChannelId === channelId ? read.channel : null;
  const hasOverride = channelState?.tokens != null;
  const editable = canEdit && !loading && (channelId === null || hasOverride || overriding);
  const scope: CmsBrandTokensScope =
    channelId === null ? { kind: 'all' } : { kind: 'channel', salesChannelId: channelId };
  const storedVersion = channelId === null ? (read?.global.version ?? 0) : (channelState?.version ?? 0);

  const findings = useMemo(() => (draft ? assessBrandContrast(draft) : []), [draft]);

  const failed = async (err: unknown): Promise<void> => {
    if (err instanceof ApiError && err.status === 409) {
      setFeedback({ kind: 'conflict' });
      await load(channelId);
      return;
    }
    setFeedback({ kind: 'error', message: errorMessage(err) });
  };

  const save = async (): Promise<boolean> => {
    if (!draft || !editable) return false;
    setFeedback(null);
    const parsed = cmsBrandTokensSchema.safeParse(draft);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
      setFeedback({ kind: 'invalid', fields });
      return false;
    }
    setSaving(true);
    try {
      await cmsClient.putBrandTokens({ scope, tokens: parsed.data, expectedVersion: storedVersion });
      setFeedback({ kind: 'saved' });
      await load(channelId);
      return true;
    } catch (err) {
      await failed(err);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const resetToGlobal = async (): Promise<void> => {
    if (!read || channelId === null) return;
    if (!hasOverride) {
      // Nothing stored yet: drop the unsaved copy.
      setOverriding(false);
      setDraft(structuredClone(read.effective));
      return;
    }
    const ok = await confirm({
      message: t('brand.scope.resetConfirm'),
      confirmLabel: t('brand.scope.reset'),
      destructive: true,
    });
    if (!ok) return;
    setFeedback(null);
    setSaving(true);
    try {
      await cmsClient.putBrandTokens({ scope, tokens: null, expectedVersion: channelState?.version ?? 0 });
      setFeedback({ kind: 'reset' });
      await load(channelId);
    } catch (err) {
      await failed(err);
    } finally {
      setSaving(false);
    }
  };

  const startOverride = (): void => {
    if (!read) return;
    setFeedback(null);
    // A complete copy of what the channel shows now, which is the global set.
    setDraft(structuredClone(read.effective));
    setOverriding(true);
  };

  const disabled = !editable;

  return (
    <div className="b2b-page b2b-page--wide space-y-4">
      <PageHeader
        title={t('brand.title')}
        description={t('brand.description')}
        actions={
          canEdit ? (
            <SaveButtonGroup
              onSave={async (): Promise<void> => {
                await save();
              }}
              onSaveAndExit={async (): Promise<void> => {
                if (await save()) navigate('/cms/pages');
              }}
              saving={saving}
              disabled={!editable || !draft}
              saveLabel={t('common.save')}
              savingLabel={t('common.saving')}
              saveAndExitLabel={t('common.saveAndExit')}
            />
          ) : null
        }
      />

      {!canEdit ? (
        <Alert>
          <AlertDescription>{t('brand.readOnly')}</AlertDescription>
        </Alert>
      ) : null}

      {feedback ? <FeedbackAlert feedback={feedback} t={t} /> : null}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <Section title={t('brand.scope.title')}>
            <div className="max-w-md space-y-1.5">
              <Label htmlFor="brand-scope-channel">{t('brand.scope.channelLabel')}</Label>
              <SalesChannelPicker
                id="brand-scope-channel"
                value={channelId}
                onChange={(next): void => {
                  setFeedback(null);
                  setChannelId(next);
                }}
                clearable
                placeholder={t('brand.scope.allChannels')}
                emptyMessage={t('brand.scope.noChannels')}
                ariaLabel={t('brand.scope.channelLabel')}
              />
              <p className="text-xs text-muted-foreground">{t('brand.scope.channelHint')}</p>
            </div>
            <ScopeState
              channelId={channelId}
              loading={loading}
              hasOverride={hasOverride}
              overriding={overriding}
              canEdit={canEdit}
              busy={saving}
              onOverride={startOverride}
              onReset={(): void => void resetToGlobal()}
              t={t}
            />
          </Section>
        </CardContent>
      </Card>

      {/* Mounted before it has text, so the change is announced (WCAG 4.1.3). */}
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {loading ? t('brand.loading') : ''}
      </p>

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('brand.loadFailed')}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={(): void => void load(channelId)}>
              {t('brand.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {draft ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <BrandCard title={t('brand.section.colors')}>
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">{t('brand.colors.palette')}</legend>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {PALETTE_ROLES.map((role) => (
                    <ColorField
                      key={role}
                      label={t(`brand.colors.${role}`)}
                      value={draft.colors[role]}
                      disabled={disabled}
                      onChange={(hex): void => edit((d) => void (d.colors[role] = hex))}
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">{t('brand.gradient.title')}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <ColorField
                    label={t('brand.gradient.from')}
                    value={draft.accentGradient.from}
                    disabled={disabled}
                    onChange={(hex): void => edit((d) => void (d.accentGradient.from = hex))}
                  />
                  <ColorField
                    label={t('brand.gradient.to')}
                    value={draft.accentGradient.to}
                    disabled={disabled}
                    onChange={(hex): void => edit((d) => void (d.accentGradient.to = hex))}
                  />
                  <NumberField
                    id="brand-gradient-angle"
                    label={t('brand.gradient.angle')}
                    value={draft.accentGradient.angle}
                    min={0}
                    max={360}
                    disabled={disabled}
                    onChange={(value): void => edit((d) => void (d.accentGradient.angle = value))}
                  />
                </div>
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">{t('brand.colors.neutral')}</legend>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  {NEUTRAL_STEPS.map((step) => (
                    <ColorField
                      key={step}
                      label={t('brand.colors.neutralStep', { step })}
                      value={draft.colors.neutral[step]}
                      disabled={disabled}
                      onChange={(hex): void => edit((d) => void (d.colors.neutral[step] = hex))}
                    />
                  ))}
                </div>
              </fieldset>
            </BrandCard>

            <BrandCard title={t('brand.section.schemes')} description={t('brand.schemes.hint')}>
              {BRAND_SCHEMES.map((scheme) => (
                <SchemeFields
                  key={scheme}
                  scheme={scheme}
                  tokens={draft}
                  disabled={disabled}
                  edit={edit}
                  t={t}
                />
              ))}
            </BrandCard>

            <BrandCard title={t('brand.section.typography')}>
              <div className="grid gap-3 xl:grid-cols-2">
                <BrandFontFields
                  idPrefix="brand-font-heading"
                  legend={t('brand.fonts.heading')}
                  value={draft.fonts.heading}
                  disabled={disabled}
                  onChange={(next): void => edit((d) => void (d.fonts.heading = next))}
                />
                <BrandFontFields
                  idPrefix="brand-font-body"
                  legend={t('brand.fonts.body')}
                  value={draft.fonts.body}
                  disabled={disabled}
                  onChange={(next): void => edit((d) => void (d.fonts.body = next))}
                />
              </div>
              <TypeScaleTable tokens={draft} disabled={disabled} edit={edit} t={t} />
            </BrandCard>

            <BrandCard title={t('brand.section.buttons')}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="brand-button-radius">{t('brand.buttons.radius')}</Label>
                  <Select
                    id="brand-button-radius"
                    value={draft.buttons.radius}
                    disabled={disabled}
                    onChange={(e): void =>
                      edit((d) => void (d.buttons.radius = e.target.value as CmsBrandTokens['buttons']['radius']))
                    }
                  >
                    <option value="square">{t('brand.buttons.radius.square')}</option>
                    <option value="rounded">{t('brand.buttons.radius.rounded')}</option>
                    <option value="pill">{t('brand.buttons.radius.pill')}</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-button-weight">{t('brand.buttons.fontWeight')}</Label>
                  <Select
                    id="brand-button-weight"
                    value={String(draft.buttons.fontWeight)}
                    disabled={disabled}
                    onChange={(e): void =>
                      edit(
                        (d) =>
                          void (d.buttons.fontWeight = Number(e.target.value) as CmsBrandTokens['buttons']['fontWeight']),
                      )
                    }
                  >
                    {BUTTON_WEIGHTS.map((weight) => (
                      <option key={weight} value={weight}>
                        {weight}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-button-transform">{t('brand.buttons.textTransform')}</Label>
                  <Select
                    id="brand-button-transform"
                    value={draft.buttons.textTransform}
                    disabled={disabled}
                    onChange={(e): void =>
                      edit((d) => void (d.buttons.textTransform = e.target.value as 'none' | 'uppercase'))
                    }
                  >
                    <option value="none">{t('brand.buttons.textTransform.none')}</option>
                    <option value="uppercase">{t('brand.buttons.textTransform.uppercase')}</option>
                  </Select>
                </div>
                {(['small', 'medium', 'large'] as const).map((size) => (
                  <NumberField
                    key={size}
                    id={`brand-button-height-${size}`}
                    label={t(`brand.buttons.height${size[0]!.toUpperCase()}${size.slice(1)}`)}
                    value={draft.buttons.heights[size]}
                    min={28}
                    max={72}
                    disabled={disabled}
                    onChange={(value): void => edit((d) => void (d.buttons.heights[size] = value))}
                  />
                ))}
              </div>
            </BrandCard>

            <BrandCard title={t('brand.section.spacing')} description={t('brand.spacing.hint')}>
              <table className="w-full max-w-xl text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="pb-2 font-medium">{t('brand.spacing.step')}</th>
                    <th scope="col" className="pb-2 font-medium">{t('brand.spacing.mobilePx')}</th>
                    <th scope="col" className="pb-2 font-medium">{t('brand.spacing.desktopPx')}</th>
                  </tr>
                </thead>
                <tbody>
                  {BRAND_SPACE_TOKENS.map((step) => (
                    <tr key={step}>
                      <th scope="row" className="py-1 pr-3 text-left font-medium">{t(`brand.space.${step}`)}</th>
                      {(['mobilePx', 'desktopPx'] as const).map((tier) => (
                        <td key={tier} className="py-1 pr-3">
                          <NumberField
                            id={`brand-space-${step}-${tier}`}
                            label={t('brand.typeScale.cellLabel', {
                              role: t(`brand.space.${step}`),
                              field: t(`brand.spacing.${tier}`),
                            })}
                            labelHidden
                            value={draft.spacing[step][tier]}
                            min={0}
                            max={320}
                            disabled={disabled}
                            onChange={(value): void => edit((d) => void (d.spacing[step][tier] = value))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </BrandCard>

            <BrandCard title={t('brand.section.layout')}>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['containerMaxPx', 'widePx', 'gutterMobilePx', 'gutterDesktopPx'] as const).map((key) => (
                  <NumberField
                    key={key}
                    id={`brand-layout-${key}`}
                    label={t(`brand.layout.${key}`)}
                    value={draft.layout[key]}
                    min={key.startsWith('gutter') ? 0 : 320}
                    max={key.startsWith('gutter') ? 160 : 3840}
                    disabled={disabled}
                    onChange={(value): void => edit((d) => void (d.layout[key] = value))}
                  />
                ))}
              </div>
              {/* R20F (T322): the type and spacing scale on a tablet and a small desktop; empty is 1. */}
              <p className="text-sm text-muted-foreground">{t('brand.layout.scaleHint')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['tablet', 'smallDesktop'] as const).map((tier) => (
                  <FactorField
                    key={tier}
                    id={`brand-tier-scale-${tier}`}
                    label={t(tier === 'tablet' ? 'brand.layout.tabletScale' : 'brand.layout.smallDesktopScale')}
                    value={draft.tierScale?.[tier]}
                    disabled={disabled}
                    onChange={(value): void => edit((d) => setTierScale(d, tier, value))}
                  />
                ))}
              </div>
              {/* R21H (T351, T352): fluid desktop sizes and scaled buttons. */}
              <p className="text-sm text-muted-foreground">{t('brand.layout.tierHint')}</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="brand-tier-scale-fluidDesktop"
                    checked={draft.tierScale?.fluidDesktop === true}
                    disabled={disabled}
                    onChange={(event): void => edit((d) => setTierScale(d, 'fluidDesktop', event.target.checked ? true : undefined))}
                  />
                  {t('brand.layout.fluidDesktop')}
                </label>
                {draft.tierScale?.fluidDesktop === true ? (
                  <FactorField
                    id="brand-tier-scale-fluidUntilPx"
                    label={t('brand.layout.fluidUntilPx')}
                    value={draft.tierScale?.fluidUntilPx}
                    min={1025}
                    max={3840}
                    step={1}
                    disabled={disabled}
                    onChange={(value): void => edit((d) => setTierScale(d, 'fluidUntilPx', value))}
                  />
                ) : null}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="brand-tier-scale-buttons"
                    checked={draft.tierScale?.buttons === true}
                    disabled={disabled}
                    onChange={(event): void => edit((d) => setTierScale(d, 'buttons', event.target.checked ? true : undefined))}
                  />
                  {t('brand.layout.scaleButtons')}
                </label>
              </div>
            </BrandCard>
          </div>

          <section aria-label={t('brand.preview.title')} className="lg:col-span-4">
            <div className="space-y-4 lg:sticky lg:top-4">
              {findings.length > 0 ? (
                <Alert variant="warning">
                  <AlertTitle>{t('brand.contrast.title')}</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>{t('brand.contrast.description')}</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {findings.map((finding) => (
                        <li key={finding.pair}>{describeFinding(finding, t)}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              <Card>
                <CardContent className="pt-6">
                  <Section title={t('brand.preview.title')}>
                    <p className="text-xs text-muted-foreground">{t('brand.preview.hint')}</p>
                    <BrandPreview tokens={draft} />
                  </Section>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      ) : null}
      {confirmDialog}
    </div>
  );
}

function FeedbackAlert({ feedback, t }: { feedback: Feedback; t: Translate }): ReactElement {
  switch (feedback.kind) {
    case 'saved':
      return (
        <Alert variant="success">
          <AlertDescription>{t('brand.saved')}</AlertDescription>
        </Alert>
      );
    case 'reset':
      return (
        <Alert variant="success">
          <AlertDescription>{t('brand.resetDone')}</AlertDescription>
        </Alert>
      );
    case 'conflict':
      return (
        <Alert variant="destructive">
          <AlertDescription>{t('brand.errors.conflict')}</AlertDescription>
        </Alert>
      );
    case 'invalid':
      return (
        <Alert variant="destructive">
          <AlertDescription>{t('brand.errors.invalid', { fields: feedback.fields })}</AlertDescription>
        </Alert>
      );
    case 'error':
      return (
        <Alert variant="destructive">
          <AlertDescription>{t('brand.errors.saveFailed', { message: feedback.message })}</AlertDescription>
        </Alert>
      );
  }
}

function ScopeState(props: {
  channelId: string | null;
  loading: boolean;
  hasOverride: boolean;
  overriding: boolean;
  canEdit: boolean;
  busy: boolean;
  onOverride: () => void;
  onReset: () => void;
  t: Translate;
}): ReactElement | null {
  const { t } = props;
  if (props.channelId === null) {
    return <p className="text-sm text-muted-foreground">{t('brand.scope.globalHint')}</p>;
  }
  if (props.loading) return null;
  const reset = props.canEdit ? (
    <Button type="button" variant="outline" size="sm" disabled={props.busy} onClick={props.onReset}>
      {t('brand.scope.reset')}
    </Button>
  ) : null;

  if (props.hasOverride) {
    return (
      <div className="space-y-3">
        <Badge variant="secondary">{t('brand.scope.overriddenBadge')}</Badge>
        <Alert>
          <AlertDescription>{t('brand.scope.overriddenNotice')}</AlertDescription>
        </Alert>
        {reset}
      </div>
    );
  }
  if (props.overriding) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">{t('brand.scope.overrideDraftBadge')}</Badge>
        <p className="text-sm text-muted-foreground">{t('brand.scope.overrideDraft')}</p>
        {reset}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="outline">{t('brand.scope.inheritsBadge')}</Badge>
      <p className="text-sm text-muted-foreground">{t('brand.scope.inherits')}</p>
      {props.canEdit ? (
        <Button type="button" variant="outline" size="sm" onClick={props.onOverride}>
          {t('brand.scope.override')}
        </Button>
      ) : null}
    </div>
  );
}

function SchemeFields(props: {
  scheme: BrandScheme;
  tokens: CmsBrandTokens;
  disabled: boolean;
  edit: (mutate: (tokens: CmsBrandTokens) => void) => void;
  t: Translate;
}): ReactElement {
  const { scheme, tokens, disabled, edit, t } = props;
  const schemeName = t(`brand.schemes.${scheme}`);
  const colors = tokens.schemes[scheme];
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-semibold">{schemeName}</legend>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {SCHEME_FIELDS.map((field) => (
          <ColorField
            key={field}
            label={t('brand.schemes.colorLabel', { scheme: schemeName, field: t(`brand.schemeField.${field}`) })}
            value={colors[field]}
            disabled={disabled}
            onChange={(hex): void => edit((d) => void (d.schemes[scheme][field] = hex))}
          />
        ))}
      </div>
      {scheme === 'dark' ? (
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="brand-dark-decorative">{t('brand.schemeField.decorative')}</Label>
          <AssetFieldPicker
            id="brand-dark-decorative"
            value={colors.decorativeAssetId ?? ''}
            acceptMimePrefix="image/"
            disabled={disabled}
            ariaLabel={t('brand.schemeField.decorative')}
            onChange={(assetId): void =>
              edit((d) => {
                if (assetId) d.schemes.dark.decorativeAssetId = assetId;
                else delete d.schemes.dark.decorativeAssetId;
              })
            }
          />
          {/* T154: or a URL, as for a video; the library asset wins when both are set. */}
          <Label htmlFor="brand-dark-decorative-url" className="pt-2">
            {t('brand.schemeField.decorativeUrl')}
          </Label>
          <Input
            id="brand-dark-decorative-url"
            type="url"
            inputMode="url"
            value={colors.decorativeUrl ?? ''}
            disabled={disabled}
            maxLength={2048}
            placeholder={t('brand.schemeField.decorativeUrlPlaceholder')}
            aria-describedby="brand-dark-decorative-url-hint"
            onChange={(e): void =>
              edit((d) => {
                const url = e.target.value.trim();
                if (url) d.schemes.dark.decorativeUrl = url;
                else delete d.schemes.dark.decorativeUrl;
              })
            }
          />
          <p id="brand-dark-decorative-url-hint" className="text-xs text-muted-foreground">
            {t('brand.schemeField.decorativeUrlHint')}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

function TypeScaleTable(props: {
  tokens: CmsBrandTokens;
  disabled: boolean;
  edit: (mutate: (tokens: CmsBrandTokens) => void) => void;
  t: Translate;
}): ReactElement {
  const { tokens, disabled, edit, t } = props;
  const numeric = [
    { field: 'mobilePx', min: 10, max: 160, step: 1 },
    { field: 'desktopPx', min: 10, max: 160, step: 1 },
    { field: 'lineHeight', min: 0.8, max: 2.2, step: 0.01 },
    { field: 'trackingEm', min: -0.1, max: 0.2, step: 0.005 },
  ] as const;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t('brand.typeScale.title')}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="pb-2 pr-2 font-medium">{t('brand.typeScale.role')}</th>
              {numeric.map(({ field }) => (
                <th key={field} scope="col" className="pb-2 pr-2 font-medium">
                  {t(`brand.typeScale.${field}`)}
                </th>
              ))}
              <th scope="col" className="pb-2 pr-2 font-medium">{t('brand.typeScale.weight')}</th>
              <th scope="col" className="pb-2 font-medium">{t('brand.typeScale.font')}</th>
            </tr>
          </thead>
          <tbody>
            {BRAND_TYPE_TOKENS.map((role) => {
              const style = tokens.typeScale[role];
              const roleName = t(`brand.type.${role}`);
              const cell = (field: string): string =>
                t('brand.typeScale.cellLabel', { role: roleName, field: t(`brand.typeScale.${field}`) });
              return (
                <tr key={role}>
                  <th scope="row" className="py-1 pr-2 text-left font-medium">{roleName}</th>
                  {numeric.map(({ field, min, max, step }) => (
                    <td key={field} className="py-1 pr-2">
                      <NumberField
                        id={`brand-type-${role}-${field}`}
                        label={cell(field)}
                        labelHidden
                        value={style[field]}
                        min={min}
                        max={max}
                        step={step}
                        disabled={disabled}
                        onChange={(value): void => edit((d) => void (d.typeScale[role][field] = value))}
                      />
                    </td>
                  ))}
                  <td className="py-1 pr-2">
                    <Label htmlFor={`brand-type-${role}-weight`} className="sr-only">
                      {cell('weight')}
                    </Label>
                    <Select
                      id={`brand-type-${role}-weight`}
                      value={String(style.weight)}
                      disabled={disabled}
                      onChange={(e): void =>
                        edit(
                          (d) =>
                            void (d.typeScale[role].weight = Number(
                              e.target.value,
                            ) as CmsBrandTokens['typeScale'][typeof role]['weight']),
                        )
                      }
                    >
                      {TYPE_WEIGHTS.map((weight) => (
                        <option key={weight} value={weight}>
                          {weight}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1">
                    <Label htmlFor={`brand-type-${role}-font`} className="sr-only">
                      {cell('font')}
                    </Label>
                    <Select
                      id={`brand-type-${role}-font`}
                      value={style.font}
                      disabled={disabled}
                      onChange={(e): void =>
                        edit((d) => void (d.typeScale[role].font = e.target.value as 'heading' | 'body'))
                      }
                    >
                      <option value="heading">{t('brand.typeScale.font.heading')}</option>
                      <option value="body">{t('brand.typeScale.font.body')}</option>
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default BrandPage;

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@endora-commerce/admin-kit/ui';
import { FileDropzone } from '@endora-commerce/admin-kit/components';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { productFeedsClient, type FeedTemplateDocumentBody } from '../api.js';

/**
 * Template import — ux-design §2.9, FR-014 – FR-018.
 *
 * Three steps on one page, and the middle one is the whole point: **never
 * import blind**. The operator sees what the file contains, which of its
 * bindings this shop can satisfy, and — if the name collides — what will happen
 * to the template they already have, *before* anything is written.
 *
 * Two rules the design is explicit about:
 *
 *  - the collision radio group has **no destructive default**. "Keep both" is
 *    preselected; "Replace" only ever happens because someone chose it, and it
 *    reveals the consequence for the feeds already on that template.
 *  - a malformed file is a `destructive` alert naming the problem, with the
 *    dropzone still live for a retry. Nothing is created (FR-018), so there is
 *    nothing to undo.
 *
 * The local pre-parse is a courtesy, not a validation: the server owns
 * `feedTemplateDocumentSchema` and is the only thing that decides whether a
 * document is importable. All the browser does is turn the bytes into JSON so
 * the summary can be drawn, and hand the parsed value over unmodified.
 */

type Step = 'choose' | 'check';

interface DocumentSummary {
  name: string;
  outputFormat: string;
  itemGranularity: string;
  fieldCount: number;
  /** Bindings this shop may not have — a guess, confirmed by the server. */
  keyedBindings: Array<{ outputName: string; sourceKey: string }>;
}

/** Reads what the summary needs, tolerating anything: the server is the judge. */
function summarize(document: FeedTemplateDocumentBody): DocumentSummary | null {
  const template = (document as { template?: Record<string, unknown> }).template;
  if (!template || typeof template !== 'object') return null;
  const fields = Array.isArray(template['fields'])
    ? (template['fields'] as Array<Record<string, unknown>>)
    : [];
  return {
    name: typeof template['name'] === 'string' ? template['name'] : '',
    outputFormat: typeof template['outputFormat'] === 'string' ? template['outputFormat'] : '',
    itemGranularity:
      typeof template['itemGranularity'] === 'string' ? template['itemGranularity'] : '',
    fieldCount: fields.length,
    keyedBindings: fields
      .filter((field) => field['sourceKind'] === 'attribute' || field['sourceKind'] === 'custom_field')
      .map((field) => ({
        outputName: String(field['outputName'] ?? ''),
        sourceKey: String(field['sourceKey'] ?? ''),
      })),
  };
}

export function FeedTemplateImportPage(): ReactNode {
  const t = useTranslation('product_feeds');
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');

  const [step, setStep] = useState<Step>('choose');
  const [document, setDocument] = useState<FeedTemplateDocumentBody | null>(null);
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collision, setCollision] = useState<{ name: string; feedCount: number } | null>(null);
  const [resolution, setResolution] = useState<'create_copy' | 'replace'>('create_copy');

  const reset = (): void => {
    setStep('choose');
    setDocument(null);
    setSummary(null);
    setCollision(null);
    setResolution('create_copy');
  };

  const ingest = (_filename: string, contentBase64: string): void => {
    setError(null);
    setCollision(null);
    try {
      // `FileDropzone` hands over base64; `atob` yields bytes, which have to be
      // reassembled as UTF-8 or a template named "Cenniki hurtowe" arrives
      // mojibaked.
      const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as FeedTemplateDocumentBody;
      const next = summarize(parsed);
      if (!next) {
        setError(t('import.error.malformed', { reason: t('import.error.noTemplate') }));
        return;
      }
      setDocument(parsed);
      setSummary(next);
      setStep('check');
    } catch (err) {
      setError(
        t('import.error.malformed', {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  const submit = (onNameConflict?: 'create_copy' | 'replace'): void => {
    if (!document) return;
    setBusy(true);
    setError(null);
    void productFeedsClient
      .importTemplate(document, onNameConflict)
      .then((res) => {
        // Straight into the editor with the needs-attention filter on, so the
        // unbound fields are the first thing on screen. An import that ends on
        // a list view leaves an unfinished task with no visible next step.
        navigate(`/product-feeds/templates/${res.data.template.id}`, {
          state: {
            showOnlyProblems: res.data.unresolvedBindings.length > 0,
            importedUnresolved: res.data.unresolvedBindings,
          },
        });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          const details = err.envelope.error.details as
            | { reason?: string; existingName?: string }
            | undefined;
          if (details?.reason === 'template_name_conflict') {
            setCollision({ name: details.existingName ?? '', feedCount: 0 });
            return;
          }
          setError(err.envelope.error.message);
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <PageHeader
        title={t('import.title')}
        description={t('import.subtitle')}
        back={{ label: t('templates.title'), to: '/product-feeds/templates' }}
      />

      {!canWrite ? (
        <Alert className="mb-4">
          <AlertDescription>{t('permission.needWrite')}</AlertDescription>
        </Alert>
      ) : null}

      {error !== null ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex items-center gap-2">
            <AlertTriangle size={14} aria-hidden="true" />
            {error}
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="b2b-help mb-2">
        {t('import.step', { current: step === 'choose' ? 1 : 2, total: 3 })}
      </p>

      {step === 'choose' || summary === null ? (
        <FileDropzone
          accept=".json,application/json"
          label={t('import.dropzone.label')}
          selectedLabel={(name): string => t('import.dropzone.selected', { name })}
          onFile={ingest}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('import.summary.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">
              <strong>{summary.name}</strong>
              {' · '}
              {summary.outputFormat.toUpperCase()}
              {' · '}
              {summary.itemGranularity
                ? t(`builder.granularity.${summary.itemGranularity}`)
                : ''}
              {' · '}
              {t('templates.fields', { count: summary.fieldCount })}
            </p>

            {/* The "check what will happen" block. The exact resolvable /
                unresolvable split is the server's answer, so this states what
                the file asks for and what the consequence of a miss is. */}
            <div className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={14} aria-hidden="true" />
                {t('import.check.resolved', {
                  count: summary.fieldCount - summary.keyedBindings.length,
                })}
              </span>
              {summary.keyedBindings.length > 0 ? (
                <>
                  <span className="flex items-center gap-2">
                    <AlertTriangle size={14} aria-hidden="true" />
                    {t('import.check.mayBeUnresolved', { count: summary.keyedBindings.length })}
                  </span>
                  <ul className="ml-6 list-disc text-muted-foreground">
                    {summary.keyedBindings.map((binding) => (
                      <li key={`${binding.outputName}:${binding.sourceKey}`}>
                        {binding.outputName} → <code className="b2b-code">{binding.sourceKey}</code>
                      </li>
                    ))}
                  </ul>
                  <span className="text-muted-foreground">{t('import.check.unresolvedNote')}</span>
                </>
              ) : null}
            </div>

            {collision !== null ? (
              <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">
                  {t('import.collision.title', { name: collision.name })}
                </legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="onNameConflict"
                    value="create_copy"
                    checked={resolution === 'create_copy'}
                    onChange={(): void => setResolution('create_copy')}
                  />
                  {t('import.collision.keepBoth', { name: `${collision.name} (imported)` })}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="onNameConflict"
                    value="replace"
                    checked={resolution === 'replace'}
                    onChange={(): void => setResolution('replace')}
                  />
                  {t('import.collision.replace')}
                </label>
                {resolution === 'replace' ? (
                  <p className="text-xs text-muted-foreground">
                    {t('import.collision.replaceConsequence')}
                  </p>
                ) : null}
              </fieldset>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={reset} disabled={busy}>
                {t('import.action.another')}
              </Button>
              <Button
                type="button"
                disabled={!canWrite || busy}
                title={!canWrite ? t('permission.needWrite') : undefined}
                onClick={(): void => submit(collision === null ? undefined : resolution)}
              >
                <Upload size={14} aria-hidden="true" />
                {busy ? t('import.action.importing') : t('import.action.import')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * The default export the route declaration's dynamic-import factory takes
 * (`contracts/admin-contribution.md` R6). The named export is kept because the
 * screen is also the subject of this module's own admin tests.
 */
export default FeedTemplateImportPage;

/**
 * Storefront Speculation Rules configuration, resolved from the Settings
 * module (`storefront.speculation_rules.*`). Read server-side in the root
 * layout to decide whether to emit the Speculation Rules script.
 */
export interface SpeculationRulesConfig {
  enabled: boolean;
  /** conservative | moderate | eager */
  eagerness: string;
}

export async function getSpeculationRulesConfig(): Promise<SpeculationRulesConfig> {
  const fallback: SpeculationRulesConfig = { enabled: true, eagerness: 'moderate' };
  const baseUrl = process.env['BACKEND_BASE_URL'] ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${baseUrl}/api/v1/storefront/speculation-rules`, {
      cache: 'no-store',
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as { data: SpeculationRulesConfig };
    return body.data ?? fallback;
  } catch {
    return fallback;
  }
}

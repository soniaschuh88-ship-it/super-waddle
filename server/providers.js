/**
 * server/providers.js — bKG Free Provider Registry
 *
 * Canonical list of all supported cloud AI providers, derived from the
 * pi-free-providers extension (https://github.com/apmantza/pi-free, MIT).
 * Fully rebrandedinto bKG.
 *
 * Provider tiers:
 *   free        — No key required (or free account only, no card)
 *   freemium    — Free tier with usage limits
 *   paid        — Requires paid credits (but may have trial credits)
 *   dynamic     — Available only when API key is configured
 *
 * Fallback chain for every inference request:
 *   1. User's own API key
 *   2. Admin's global key
 *   3. Free/anonymous access (if tier === 'free' and no key needed)
 */

export const PROVIDERS = [
  // ── Free tier (no payment required) ───────────────────────────────────────
  {
    id:         'kilo',
    name:       'Kilo',
    tier:       'free',
    baseUrl:    'https://api.kilo.ai/v1',
    envKey:     'KILO_API_KEY',
    configKey:  'kilo_api_key',
    description:'Free models immediately; more after OAuth login. 200 req/hr.',
    signupUrl:  'https://kilo.ai',
    anonAccess: true,   // works without a key for basic models
  },
  {
    id:         'llm7',
    name:       'LLM7',
    tier:       'free',
    baseUrl:    'https://api.llm7.io/v1',
    envKey:     'LLM7_API_KEY',
    configKey:  'llm7_api_key',
    description:'Free gateway: 100 req/hr, 20 req/min. No card required.',
    signupUrl:  'https://token.llm7.io',
    anonAccess: true,
  },
  {
    id:         'openrouter',
    name:       'OpenRouter',
    tier:       'free',
    baseUrl:    'https://openrouter.ai/api/v1',
    envKey:     'OPENROUTER_API_KEY',
    configKey:  'openrouter_api_key',
    description:'200+ models; free tier available. Free account required.',
    signupUrl:  'https://openrouter.ai/keys',
    anonAccess: false,
  },
  {
    id:         'cline',
    name:       'Cline',
    tier:       'free',
    baseUrl:    'https://api.cline.ai/v1',
    envKey:     'CLINE_API_KEY',
    configKey:  'cline_api_key',
    description:'Free Cline models via OAuth. No card required.',
    signupUrl:  'https://cline.ai',
    anonAccess: false,
  },

  // ── Freemium tier ──────────────────────────────────────────────────────────
  {
    id:         'nvidia',
    name:       'NVIDIA NIM',
    tier:       'freemium',
    baseUrl:    'https://integrate.api.nvidia.com/v1',
    envKey:     'NVIDIA_API_KEY',
    configKey:  'nvidia_api_key',
    description:'1,000 free requests/month. Zero-cost models shown by default.',
    signupUrl:  'https://build.nvidia.com',
    anonAccess: false,
  },
  {
    id:         'sambanova',
    name:       'SambaNova',
    tier:       'freemium',
    baseUrl:    'https://api.sambanova.ai/v1',
    envKey:     'SAMBANOVA_API_KEY',
    configKey:  'sambanova_api_key',
    description:'20–480 RPM free. Llama 3.3, DeepSeek, Llama 4. No card.',
    signupUrl:  'https://cloud.sambanova.ai',
    anonAccess: false,
  },
  {
    id:         'ollama-cloud',
    name:       'Ollama Cloud',
    tier:       'freemium',
    baseUrl:    'https://api.ollama.com/v1',
    envKey:     'OLLAMA_API_KEY',
    configKey:  'ollama_api_key',
    description:'Usage-based free tier, resets every 5h + 7 days.',
    signupUrl:  'https://ollama.com/settings/keys',
    anonAccess: false,
  },

  // ── Dynamic / API-key tier ─────────────────────────────────────────────────
  {
    id:         'groq',
    name:       'Groq',
    tier:       'dynamic',
    baseUrl:    'https://api.groq.com/openai/v1',
    envKey:     'GROQ_API_KEY',
    configKey:  'groq_api_key',
    description:'Fast inference. Free tier with rate limits. No card.',
    signupUrl:  'https://console.groq.com',
    anonAccess: false,
  },
  {
    id:         'mistral',
    name:       'Mistral',
    tier:       'dynamic',
    baseUrl:    'https://api.mistral.ai/v1',
    envKey:     'MISTRAL_API_KEY',
    configKey:  'mistral_api_key',
    description:'Mistral 7B, 8x7B, Large. Free dev tier available.',
    signupUrl:  'https://console.mistral.ai',
    anonAccess: false,
  },
  {
    id:         'cerebras',
    name:       'Cerebras',
    tier:       'dynamic',
    baseUrl:    'https://api.cerebras.ai/v1',
    envKey:     'CEREBRAS_API_KEY',
    configKey:  'cerebras_api_key',
    description:'Ultra-fast inference. Free tier. No card required.',
    signupUrl:  'https://cloud.cerebras.ai',
    anonAccess: false,
  },
  {
    id:         'xai',
    name:       'xAI (Grok)',
    tier:       'dynamic',
    baseUrl:    'https://api.x.ai/v1',
    envKey:     'XAI_API_KEY',
    configKey:  'xai_api_key',
    description:'Grok models. $25/month free credits.',
    signupUrl:  'https://console.x.ai',
    anonAccess: false,
  },
  {
    id:         'huggingface',
    name:       'HuggingFace',
    tier:       'dynamic',
    baseUrl:    'https://api-inference.huggingface.co/v1',
    envKey:     'HF_TOKEN',
    configKey:  'hf_token',
    description:'Serverless inference. Free token, rate-limited.',
    signupUrl:  'https://huggingface.co/settings/tokens',
    anonAccess: false,
  },
  {
    id:         'fastrouter',
    name:       'FastRouter',
    tier:       'dynamic',
    baseUrl:    'https://api.fastrouter.ai/v1',
    envKey:     'FASTROUTER_API_KEY',
    configKey:  'fastrouter_api_key',
    description:'170+ models. No auth needed for listing.',
    signupUrl:  'https://fastrouter.ai',
    anonAccess: false,
  },

  // ── Paid tier (trial credits available) ───────────────────────────────────
  {
    id:         'codestral',
    name:       'Codestral',
    tier:       'paid',
    baseUrl:    'https://codestral.mistral.ai/v1',
    envKey:     'CODESTRAL_API_KEY',
    configKey:  'codestral_api_key',
    description:'Code model. Free Experiment plan: 2 req/min, 1B tokens/month.',
    signupUrl:  'https://console.mistral.ai/codestral',
    anonAccess: false,
  },
  {
    id:         'deepinfra',
    name:       'DeepInfra',
    tier:       'paid',
    baseUrl:    'https://api.deepinfra.com/v1/openai',
    envKey:     'DEEPINFRA_TOKEN',
    configKey:  'deepinfra_api_key',
    description:'$5 one-time trial credit. 100+ models. No card.',
    signupUrl:  'https://deepinfra.com',
    anonAccess: false,
  },
  {
    id:         'together',
    name:       'Together AI',
    tier:       'paid',
    baseUrl:    'https://api.together.xyz/v1',
    envKey:     'TOGETHER_AI_API_KEY',
    configKey:  'together_api_key',
    description:'$1 trial credit. 200+ models. OpenAI-compatible.',
    signupUrl:  'https://api.together.ai',
    anonAccess: false,
  },
  {
    id:         'zenmux',
    name:       'ZenMux',
    tier:       'paid',
    baseUrl:    'https://api.zenmux.ai/v1',
    envKey:     'ZENMUX_API_KEY',
    configKey:  'zenmux_api_key',
    description:'AI gateway: OpenAI, Anthropic, Google, 200+ models.',
    signupUrl:  'https://zenmux.ai',
    anonAccess: false,
  },
  {
    id:         'crofai',
    name:       'CrofAI',
    tier:       'paid',
    baseUrl:    'https://api.crofai.com/v1',
    envKey:     'CROFAI_API_KEY',
    configKey:  'crofai_api_key',
    description:'OpenAI-compatible API. Streaming, reasoning models.',
    signupUrl:  'https://crofai.com',
    anonAccess: false,
  },
  {
    id:         'novita',
    name:       'Novita AI',
    tier:       'paid',
    baseUrl:    'https://api.novita.ai/v3/openai',
    envKey:     'NOVITA_API_KEY',
    configKey:  'novita_api_key',
    description:'100+ open-source models. 3 free models available.',
    signupUrl:  'https://novita.ai',
    anonAccess: false,
  },
];

/** Get a provider by id. */
export function getProvider(id) {
  return PROVIDERS.find(p => p.id === id) ?? null;
}

/** Providers available without an API key. */
export const FREE_PROVIDERS = PROVIDERS.filter(p => p.anonAccess);

/** Providers grouped by tier. */
export function providersByTier() {
  const groups = { free: [], freemium: [], dynamic: [], paid: [] };
  for (const p of PROVIDERS) {
    (groups[p.tier] ?? []).push(p);
  }
  return groups;
}

/**
 * Resolve the API key to use for a given provider.
 * Fallback chain: user key → admin global key → env var → undefined (anon).
 *
 * @param {string}  providerId
 * @param {object}  userKeys   — from getUserProviderKeys()
 * @param {object}  globalKeys — from getGlobalProviderKeys()
 * @returns {string|undefined} The resolved key, or undefined for anon access
 */
export function resolveProviderKey(providerId, userKeys, globalKeys) {
  const p = getProvider(providerId);
  if (!p) return undefined;

  // 1. User's own key
  if (userKeys?.[p.configKey]) return userKeys[p.configKey];

  // 2. Admin global key
  if (globalKeys?.[p.configKey]) return globalKeys[p.configKey];

  // 3. Environment variable (set in .env)
  if (p.envKey && process.env[p.envKey]) return process.env[p.envKey];

  // 4. No key — anon access only if provider supports it
  return p.anonAccess ? 'anon' : undefined;
}

/**
 * Fetch models from a provider using the resolved key.
 * Returns array of { id, name, contextWindow, cost } objects.
 */
export async function fetchProviderModels(providerId, apiKey) {
  const p = getProvider(providerId);
  if (!p) return [];

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey !== 'anon') headers['Authorization'] = `Bearer ${apiKey}`;

    const url = `${p.baseUrl}/models`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);

    const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }));
    const r = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);

    if (!r.ok) return [];

    const data = await r.json();
    const list = data.data ?? data.models ?? [];

    return list.slice(0, 100).map(m => ({
      id:            m.id ?? m.model_id ?? m.name,
      name:          m.name ?? m.id ?? m.model_id,
      contextWindow: m.context_length ?? m.context_window ?? m.max_tokens ?? 4096,
      costInput:     parseFloat(m.pricing?.prompt ?? m.input_cost_per_token ?? '0') || 0,
      costOutput:    parseFloat(m.pricing?.completion ?? m.output_cost_per_token ?? '0') || 0,
    })).filter(m => m.id);

  } catch { return []; }
}

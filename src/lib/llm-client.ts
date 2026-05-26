/**
 * src/lib/llm-client.ts
 * Unified LLM client — supports 4 backends:
 *   webgpu     – WebGPU in-browser (private mode)
 *   ollama     – local Ollama (private mode)
 *   llama-cpp  – local GGUF server (private mode)
 *   cloud      – free providers via /providers/proxy (cloud mode)
 */
import type { BackendConfig, EngineProgress } from '@/types';
import { loadEngine, generateJson as wgJson, generateStreaming as wgStream, isEngineReady } from '@/lib/webllm';

// ── REST helpers ──────────────────────────────────────────────────────────────

type Msg = { role: string; content: string };

async function restComplete(base: string, model: string, msgs: Msg[], temperature = 0.3, max = 2048): Promise<string> {
  const r = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, stream: false, temperature, max_tokens: max }),
  });
  if (!r.ok) throw new Error(`Backend ${r.status}: ${await r.text()}`);
  const d = await r.json() as { choices: Array<{ message: { content: string } }> };
  return d.choices[0]?.message?.content ?? '';
}

async function restStream(base: string, model: string, msgs: Msg[], onChunk: (c: string) => void, temperature = 0.4, max = 4096): Promise<string> {
  const r = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, stream: true, temperature, max_tokens: max }),
  });
  if (!r.ok) throw new Error(`Backend ${r.status}: ${await r.text()}`);
  if (!r.body) throw new Error('No response body');
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let full = '', buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim(); if (!t.startsWith('data:')) continue;
      const json = t.slice(5).trim(); if (json === '[DONE]') break;
      try {
        const c = JSON.parse(json) as { choices: Array<{ delta: { content?: string } }> };
        const d = c.choices[0]?.delta?.content ?? '';
        if (d) { full += d; onChunk(d); }
      } catch { /**/ }
    }
  }
  return full;
}

// ── Cloud proxy (routes through /providers/proxy on serve.js) ─────────────────

const SERVE_BASE = () => window.location.origin;

/** Get caller auth headers — adds bkg user API key if present */
function cloudHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = typeof localStorage !== 'undefined' ? localStorage.getItem('bkg_user_api_key') : null;
  if (key) h['Authorization'] = `Bearer ${key}`;
  return h;
}

/** Parse "providerId/modelId" from a cloud BackendConfig.modelId */
function parseCloudModel(modelId: string): { providerId: string; model: string } {
  const slash = modelId.indexOf('/');
  if (slash < 0) return { providerId: modelId, model: modelId };
  return { providerId: modelId.slice(0, slash), model: modelId.slice(slash + 1) };
}

async function cloudComplete(
  cfg: BackendConfig, msgs: Array<{ role: string; content: string }>,
  temperature = 0.3, max = 2048,
): Promise<string> {
  const { providerId, model } = parseCloudModel(cfg.modelId);
  const r = await fetch(`${SERVE_BASE()}/providers/proxy`, {
    method:  'POST',
    headers: cloudHeaders(),
    body:    JSON.stringify({ provider: providerId, model, messages: msgs, stream: false, temperature, max_tokens: max }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Cloud provider error ${r.status}`);
  }
  const d = await r.json() as { choices: Array<{ message: { content: string } }> };
  return d.choices?.[0]?.message?.content ?? '';
}

async function cloudStream(
  cfg: BackendConfig, msgs: Array<{ role: string; content: string }>,
  onChunk: (c: string) => void, temperature = 0.4, max = 4096,
): Promise<string> {
  const { providerId, model } = parseCloudModel(cfg.modelId);
  const r = await fetch(`${SERVE_BASE()}/providers/proxy`, {
    method:  'POST',
    headers: cloudHeaders(),
    body:    JSON.stringify({ provider: providerId, model, messages: msgs, stream: true, temperature, max_tokens: max }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Cloud provider error ${r.status}`);
  }
  if (!r.body) throw new Error('No response body');

  const reader = r.body.getReader();
  const dec    = new TextDecoder();
  let full = '', buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const json = t.slice(5).trim();
      if (json === '[DONE]') break;
      try {
        const c = JSON.parse(json) as { choices: Array<{ delta: { content?: string } }> };
        const d = c.choices?.[0]?.delta?.content ?? '';
        if (d) { full += d; onChunk(d); }
      } catch { /**/ }
    }
  }
  return full;
}

// ── Connectivity ──────────────────────────────────────────────────────────────

/**
 * Proxy base URLs — all local backend calls go through the bKG server to
 * avoid CORS issues when the app is served via a tunnel (serveo, ngrok, etc).
 */
export const OLLAMA_PROXY = '/api/proxy/ollama';
export const LLAMA_PROXY  = '/api/proxy/llama';

/**
 * Ping a REST backend.
 * For local backends (Ollama / llama-cpp) this always uses the server-side
 * proxy so it works regardless of tunnel/CORS.
 */
export async function pingRestBackend(baseUrl: string): Promise<boolean> {
  // Route local backends through the server-side proxy
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    try {
      const r = await fetch('/api/proxy/ping', { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return false;
      const d = await r.json() as { ollama: boolean; llama: boolean };
      if (baseUrl.includes('11434')) return d.ollama;
      if (baseUrl.includes('8001'))  return d.llama;
      return d.ollama || d.llama;
    } catch { return false; }
  }
  // Remote URL — direct call is fine
  try {
    const r = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

// ── Ollama-specific APIs ──────────────────────────────────────────────────────

export interface OllamaModel { name: string; size: number; modified_at: string; }

export async function ollamaListModels(_base: string): Promise<OllamaModel[]> {
  // Always use server proxy — avoids CORS when tunnelled
  try {
    const r = await fetch(`${OLLAMA_PROXY}/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const d = await r.json() as { models: OllamaModel[] };
    return d.models ?? [];
  } catch { return []; }
}

export async function ollamaPullModel(_base: string, name: string, onProgress: (status: string, pct: number) => void): Promise<void> {
  const r = await fetch(`${OLLAMA_PROXY}/pull`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
  });
  if (!r.ok) throw new Error(`Pull failed: ${await r.text()}`);
  const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { status: string; completed?: number; total?: number };
        onProgress(o.status, o.total ? Math.round((o.completed ?? 0) / o.total * 100) : 0);
      } catch { /**/ }
    }
  }
}

export async function ollamaDeleteModel(_base: string, name: string): Promise<void> {
  const r = await fetch(`${OLLAMA_PROXY}/delete`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
}

/** sizeB: approximate parameter count in billions. */
export const OLLAMA_POPULAR_MODELS = [
  { name:'qwen2.5:0.5b', label:'Qwen 2.5 0.5B', description:'Tiny, very fast',            sizeB:0.5  },
  { name:'llama3.2:1b',  label:'Llama 3.2 1B',  description:'Meta 1B, fast',               sizeB:1.0  },
  { name:'qwen2.5:1.5b', label:'Qwen 2.5 1.5B', description:'Fast, good quality',          sizeB:1.5  },
  { name:'gemma2:2b',    label:'Gemma 2 2B',    description:'Google 2B, efficient',         sizeB:2.0  },
  { name:'llama3.2:3b',  label:'Llama 3.2 3B',  description:'Meta 3B, balanced',           sizeB:3.0  },
  { name:'qwen2.5:3b',   label:'Qwen 2.5 3B',   description:'Better quality',              sizeB:3.0  },
  { name:'phi3.5:mini',  label:'Phi 3.5 Mini',  description:'Microsoft 3.8B, efficient',   sizeB:3.8  },
  { name:'mistral:7b',   label:'Mistral 7B',    description:'Strong reasoning',            sizeB:7.0  },
  { name:'codellama:7b', label:'CodeLlama 7B',  description:'Code-focused',               sizeB:7.0  },
];

/** Filter models to those with sizeB ≤ maxB. */
export function filterByMaxSize<T extends { sizeB: number }>(models: T[], maxB: number): T[] {
  return models.filter(m => m.sizeB <= maxB);
}

// ── node-llama-cpp server APIs ────────────────────────────────────────────────

export interface LlamaCppModel { id: string; path: string; }
export interface LlamaCppGpuInfo { backend: string; gpuInfo: unknown }

export async function llamaCppListModels(_base: string): Promise<LlamaCppModel[]> {
  try {
    const r = await fetch(`${LLAMA_PROXY}/models`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const d = await r.json() as { data: LlamaCppModel[] };
    return d.data ?? [];
  } catch { return []; }
}

export async function llamaCppGetGpu(_base: string): Promise<LlamaCppGpuInfo | null> {
  try {
    // GPU info is served by the bKG llama-cpp server manager
    const r = await fetch('/api/llama/gpu', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    return r.json() as Promise<LlamaCppGpuInfo>;
  } catch { return null; }
}

export async function llamaCppGetHealth(_base: string): Promise<{ status: string; modelLoaded: boolean; modelPath: string | null } | null> {
  try {
    const r = await fetch(`${LLAMA_PROXY}/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export async function llamaCppSwapModel(_base: string, modelPath: string): Promise<void> {
  const r = await fetch(`${LLAMA_PROXY}/model`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelPath }),
  });
  if (!r.ok) throw new Error(`Swap failed: ${await r.text()}`);
}

export async function llamaCppPullModel(
  _base: string,
  uri: string,
  onProgress: (status: string, pct: number) => void,
): Promise<void> {
  // llama-cpp model pull goes through the bKG model manager
  const r = await fetch('/api/llama/pull', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uri }),
  });
  if (!r.ok) throw new Error(`Pull failed: ${await r.text()}`);
  const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const raw = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
      if (raw === '[DONE]') return;
      try {
        const o = JSON.parse(raw) as { status: string; message?: string; pct?: number };
        if (o.status === 'done') return;
        if (o.status === 'error') throw new Error(o.message ?? 'Pull failed');
        onProgress(o.message ?? o.status, o.pct ?? 0);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Pull failed')) throw e;
      }
    }
  }
}

export async function llamaCppDeleteModel(_base: string, filename: string): Promise<void> {
  // Route through the bKG model manager endpoint
  const r = await fetch(`/api/llama/models/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
}

/** Recommended GGUF models — sizeB is approximate parameter count. */
export const LLAMA_CPP_RECOMMENDED = [
  { uri:'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M',              label:'Qwen 2.5 0.5B', description:'~350 MB · Tiny & fast',            sizeB:0.5 },
  { uri:'hf:bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M',         label:'Llama 3.2 1B',  description:'~650 MB · Meta 1B',                sizeB:1.0 },
  { uri:'hf:HuggingFaceTB/smollm2-1.7b-instruct-GGUF:Q4_K_M',     label:'SmolLM 2 1.7B', description:'~1 GB · HuggingFace compact',      sizeB:1.7 },
  { uri:'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M',              label:'Qwen 2.5 1.5B', description:'~950 MB · Fast & good quality',    sizeB:1.5 },
  { uri:'hf:Qwen/Qwen2.5-3B-Instruct-GGUF:Q4_K_M',                label:'Qwen 2.5 3B',   description:'~2 GB · Better quality',           sizeB:3.0 },
  { uri:'hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M',         label:'Llama 3.2 3B',  description:'~2 GB · Meta 3B',                  sizeB:3.0 },
  { uri:'hf:bartowski/Phi-3.5-mini-instruct-GGUF:Q4_K_M',         label:'Phi 3.5 Mini',  description:'~2.4 GB · Microsoft',             sizeB:3.8 },
  { uri:'hf:TheBloke/Mistral-7B-Instruct-v0.2-GGUF:Q4_K_M',       label:'Mistral 7B',    description:'~4.4 GB · High quality',           sizeB:7.0 },
  { uri:'hf:TheBloke/CodeLlama-7B-Instruct-GGUF:Q4_K_M',          label:'CodeLlama 7B',  description:'~4.1 GB · Code-focused',           sizeB:7.0 },
];

// ── Process manager APIs (server/manager.js) ─────────────────────────────────

export interface ManagerServerStatus {
  name:      string;
  pid:       number | null;
  running:   boolean;
  reachable: boolean;
  port:      number;
}

export interface ManagerStatus {
  llama:  ManagerServerStatus;
  ollama: ManagerServerStatus;
}

export async function managerGetStatus(managerUrl: string): Promise<ManagerStatus | null> {
  try {
    const r = await fetch(`${managerUrl}/status`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return r.json() as Promise<ManagerStatus>;
  } catch { return null; }
}

export async function managerStartLlama(
  managerUrl: string,
  opts: { modelPath?: string; nCtx?: number; gpuLayers?: number } = {},
): Promise<{ pid?: number; error?: string }> {
  const r = await fetch(`${managerUrl}/llama/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  return r.json();
}

export async function managerStopLlama(managerUrl: string): Promise<{ ok?: boolean; error?: string }> {
  const r = await fetch(`${managerUrl}/llama/stop`, { method: 'POST' });
  return r.json();
}

export async function managerStartOllama(managerUrl: string): Promise<{ pid?: number; error?: string }> {
  const r = await fetch(`${managerUrl}/ollama/start`, { method: 'POST' });
  return r.json();
}

export async function managerStopOllama(managerUrl: string): Promise<{ ok?: boolean; error?: string }> {
  const r = await fetch(`${managerUrl}/ollama/stop`, { method: 'POST' });
  return r.json();
}

export async function managerGetLogs(managerUrl: string, server: 'llama' | 'ollama'): Promise<string[]> {
  try {
    const r = await fetch(`${managerUrl}/logs/${server}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const d = await r.json() as { lines: string[] };
    return d.lines ?? [];
  } catch { return []; }
}

export interface SystemdUnits {
  llama:  { unitFile: string; content: string; commands: string[] };
  ollama: { unitFile: string; installCommand: string; commands: string[] };
}

export async function managerGetSystemdUnits(managerUrl: string): Promise<SystemdUnits | null> {
  try {
    const r = await fetch(`${managerUrl}/systemd-units`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return r.json() as Promise<SystemdUnits>;
  } catch { return null; }
}

// ── Unified public API ────────────────────────────────────────────────────────

export async function loadClient(config: BackendConfig, onProgress: (p: EngineProgress) => void): Promise<void> {
  if (config.type === 'webgpu') return loadEngine(config.modelId, onProgress);
  if (config.type === 'cloud') {
    onProgress({ progress: 50, text: 'Connecting to cloud provider…' });
    // Verify the proxy is reachable
    const r = await fetch(`${SERVE_BASE()}/providers/list`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (!r?.ok) throw new Error('bKG server not reachable. Is serve.js running?');
    onProgress({ progress: 100, text: 'Cloud ready.' });
    return;
  }
  onProgress({ progress: 10, text: `Connecting to ${config.serverUrl}…` });
  const ok = await pingRestBackend(config.serverUrl);
  if (!ok) throw new Error(
    `Cannot reach ${config.type === 'ollama' ? 'Ollama' : 'node-llama-cpp'} server. Make sure it is running.`,
  );
  onProgress({ progress: 100, text: 'Server reachable.' });
}

export function isClientReady(config: BackendConfig): boolean {
  if (config.type === 'webgpu') return isEngineReady();
  if (config.type === 'cloud') return config.modelId.length > 0;
  return config.serverUrl.length > 0;
}

export async function generateJson<T>(system: string, user: string, config: BackendConfig): Promise<T | null> {
  const msgs = [{ role: 'system', content: system }, { role: 'user', content: user }];
  if (config.type === 'webgpu') return wgJson<T>(system, user);
  if (config.type === 'cloud') {
    const raw = await cloudComplete(config, msgs, 0.2, 2048);
    const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
    try { return JSON.parse(clean) as T; } catch { console.error('[llm-client] cloud parse fail:', raw.slice(0,300)); return null; }
  }
  const raw = await restComplete(config.serverUrl, config.modelId, msgs, 0.2, 2048);
  const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  try { return JSON.parse(clean) as T; } catch { console.error('[llm-client] parse fail:', raw.slice(0,300)); return null; }
}

export async function generateStreaming(system: string, user: string, onChunk: (c: string) => void, max: number, config: BackendConfig): Promise<string> {
  const msgs = [{ role: 'system', content: system }, { role: 'user', content: user }];
  if (config.type === 'webgpu') return wgStream(system, user, onChunk, max);
  if (config.type === 'cloud') return cloudStream(config, msgs, onChunk, 0.4, max);
  return restStream(config.serverUrl, config.modelId, msgs, onChunk, 0.4, max);
}

// ── bKG Coding Agent API (talks to serve.js /agent/* + /plugins/* + /settings) ──

// SERVE_BASE is defined above (cloud proxy section)

import type {
  AgentSession, AgentEvent, AgentSettings,
  Plugin, PluginSearchResult,
} from '@/types';

// ─── Agent sessions ──────────────────────────────────────────────────────────

/** Start a new coding agent session. Returns the sessionId. */
export async function agentStartSession(opts: {
  cwd?: string;
  systemPrompt?: string;
  tools?: string[];
  initialMessage?: string;
}): Promise<{ sessionId: string }> {
  const r = await fetch(`${SERVE_BASE()}/agent/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!r.ok) throw new Error(`Agent start failed: ${await r.text()}`);
  return r.json() as Promise<{ sessionId: string }>;
}

/** Send a user message to a running agent session. */
export async function agentSendMessage(sessionId: string, text: string): Promise<void> {
  const r = await fetch(`${SERVE_BASE()}/agent/session/${sessionId}/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`Send failed: ${await r.text()}`);
}

/** Abort the current agent turn. */
export async function agentAbort(sessionId: string): Promise<void> {
  await fetch(`${SERVE_BASE()}/agent/session/${sessionId}/abort`, { method: 'POST' });
}

/** Dispose (clean up) an agent session. */
export async function agentDispose(sessionId: string): Promise<void> {
  await fetch(`${SERVE_BASE()}/agent/session/${sessionId}`, { method: 'DELETE' });
}

/** List all active sessions. */
export async function agentListSessions(): Promise<AgentSession[]> {
  const r = await fetch(`${SERVE_BASE()}/agent/sessions`);
  if (!r.ok) return [];
  return r.json() as Promise<AgentSession[]>;
}

/** Poll for new events since a given index. */
export async function agentPollEvents(sessionId: string, afterIndex = 0): Promise<{ events: AgentEvent[]; total: number }> {
  const r = await fetch(`${SERVE_BASE()}/agent/session/${sessionId}/poll?after=${afterIndex}`);
  if (!r.ok) return { events: [], total: 0 };
  return r.json() as Promise<{ events: AgentEvent[]; total: number }>;
}

// ─── Agent settings ───────────────────────────────────────────────────────────

export async function getAgentSettings(): Promise<AgentSettings | null> {
  try {
    const r = await fetch(`${SERVE_BASE()}/settings`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return r.json() as Promise<AgentSettings>;
  } catch { return null; }
}

export async function saveAgentSettings(partial: Partial<AgentSettings>): Promise<AgentSettings> {
  const r = await fetch(`${SERVE_BASE()}/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  if (!r.ok) throw new Error(`Save failed: ${await r.text()}`);
  return r.json() as Promise<AgentSettings>;
}

// ─── Plugin manager ───────────────────────────────────────────────────────────

export async function pluginsList(): Promise<Plugin[]> {
  try {
    const r = await fetch(`${SERVE_BASE()}/plugins`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    return r.json() as Promise<Plugin[]>;
  } catch { return []; }
}

/**
 * Install a plugin with SSE progress.
 * @param source  "npm:@scope/pkg" | "git:github.com/user/repo"
 * @param onLine  Called with each progress line
 */
export async function pluginsInstall(
  source: string,
  onLine: (msg: string) => void,
): Promise<Plugin> {
  const r = await fetch(`${SERVE_BASE()}/plugins/install`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  if (!r.ok) throw new Error(`Install failed: ${await r.text()}`);
  if (!r.body) throw new Error('No response body');

  const reader = r.body.getReader();
  const dec    = new TextDecoder();
  let buf      = '';
  let result: Plugin | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const json = t.slice(5).trim();
      if (json === '[DONE]') break;
      try {
        const obj = JSON.parse(json) as { status: string; message?: string; plugin?: Plugin };
        if (obj.status === 'done' && obj.plugin) result = obj.plugin;
        else if (obj.message) onLine(obj.message);
        if (obj.status === 'error') throw new Error(obj.message ?? 'Install failed');
      } catch (e) {
        if (e instanceof Error && !e.message.includes('JSON')) throw e;
      }
    }
  }

  if (!result) throw new Error('Install completed but no plugin data returned');
  return result;
}

export async function pluginsRemove(source: string): Promise<void> {
  const r = await fetch(`${SERVE_BASE()}/plugins/${encodeURIComponent(source)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`Remove failed: ${await r.text()}`);
}

export async function pluginsSetEnabled(source: string, enabled: boolean): Promise<void> {
  await fetch(`${SERVE_BASE()}/plugins/${encodeURIComponent(source)}/enabled`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export async function pluginsSearch(query = 'pi-package'): Promise<PluginSearchResult[]> {
  try {
    const r = await fetch(`${SERVE_BASE()}/plugins/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    return r.json() as Promise<PluginSearchResult[]>;
  } catch { return []; }
}

/**
 * src/lib/llm-client.ts
 * Unified LLM client — 3 real backends: webgpu | ollama | llama-cpp
 * No mlc-server, no llama-node (both removed as redundant/replaced).
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

// ── Connectivity ──────────────────────────────────────────────────────────────

export async function pingRestBackend(baseUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

// ── Ollama-specific APIs ──────────────────────────────────────────────────────

export interface OllamaModel { name: string; size: number; modified_at: string; }

export async function ollamaListModels(base: string): Promise<OllamaModel[]> {
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return [];
    const d = await r.json() as { models: OllamaModel[] };
    return d.models ?? [];
  } catch { return []; }
}

export async function ollamaPullModel(base: string, name: string, onProgress: (status: string, pct: number) => void): Promise<void> {
  const r = await fetch(`${base}/api/pull`, {
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

export async function ollamaDeleteModel(base: string, name: string): Promise<void> {
  const r = await fetch(`${base}/api/delete`, {
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

export async function llamaCppListModels(base: string): Promise<LlamaCppModel[]> {
  try {
    const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return [];
    const d = await r.json() as { data: LlamaCppModel[] };
    return d.data ?? [];
  } catch { return []; }
}

export async function llamaCppGetGpu(base: string): Promise<LlamaCppGpuInfo | null> {
  try {
    const r = await fetch(`${base}/gpu`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    return r.json() as Promise<LlamaCppGpuInfo>;
  } catch { return null; }
}

export async function llamaCppGetHealth(base: string): Promise<{ status: string; modelLoaded: boolean; modelPath: string | null } | null> {
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export async function llamaCppSwapModel(base: string, modelPath: string): Promise<void> {
  const r = await fetch(`${base}/model`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelPath }),
  });
  if (!r.ok) throw new Error(`Swap failed: ${await r.text()}`);
}

export async function llamaCppPullModel(
  base: string,
  uri: string,
  onProgress: (status: string, pct: number) => void,
): Promise<void> {
  const r = await fetch(`${base}/models/pull`, {
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

export async function llamaCppDeleteModel(base: string, filename: string): Promise<void> {
  const r = await fetch(`${base}/models/${encodeURIComponent(filename)}`, { method: 'DELETE' });
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
  onProgress({ progress: 10, text: `Connecting to ${config.serverUrl}…` });
  const ok = await pingRestBackend(config.serverUrl);
  if (!ok) throw new Error(
    `Cannot reach ${config.type === 'ollama' ? 'Ollama' : 'node-llama-cpp'} server at ${config.serverUrl}. ` +
    `Make sure it is running.`
  );
  onProgress({ progress: 100, text: 'Server reachable.' });
}

export function isClientReady(config: BackendConfig): boolean {
  return config.type === 'webgpu' ? isEngineReady() : config.serverUrl.length > 0;
}

export async function generateJson<T>(system: string, user: string, config: BackendConfig): Promise<T | null> {
  if (config.type === 'webgpu') return wgJson<T>(system, user);
  const raw = await restComplete(config.serverUrl, config.modelId,
    [{ role: 'system', content: system }, { role: 'user', content: user }], 0.2, 2048);
  const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  try { return JSON.parse(clean) as T; } catch { console.error('[llm-client] parse fail:', raw.slice(0,300)); return null; }
}

export async function generateStreaming(system: string, user: string, onChunk: (c: string) => void, max: number, config: BackendConfig): Promise<string> {
  if (config.type === 'webgpu') return wgStream(system, user, onChunk, max);
  return restStream(config.serverUrl, config.modelId,
    [{ role: 'system', content: system }, { role: 'user', content: user }], onChunk, 0.4, max);
}

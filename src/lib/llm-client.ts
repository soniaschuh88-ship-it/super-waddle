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

export const OLLAMA_POPULAR_MODELS = [
  { name: 'qwen2.5:1.5b',  label: 'Qwen 2.5 1.5B',  description: 'Fast, good quality' },
  { name: 'qwen2.5:3b',    label: 'Qwen 2.5 3B',    description: 'Better quality' },
  { name: 'llama3.2:1b',   label: 'Llama 3.2 1B',   description: 'Meta, very fast' },
  { name: 'llama3.2:3b',   label: 'Llama 3.2 3B',   description: 'Meta, balanced' },
  { name: 'mistral:7b',    label: 'Mistral 7B',      description: 'Strong reasoning' },
  { name: 'codellama:7b',  label: 'CodeLlama 7B',   description: 'Code-focused' },
  { name: 'phi3.5:mini',   label: 'Phi 3.5 Mini',    description: 'Microsoft, efficient' },
  { name: 'gemma2:2b',     label: 'Gemma 2 2B',     description: 'Google, compact' },
];

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

// Recommended models for node-llama-cpp (HuggingFace URIs)
export const LLAMA_CPP_RECOMMENDED = [
  { uri: 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M',              label: 'Qwen 2.5 1.5B Q4', description: '~1 GB · Fast & good quality' },
  { uri: 'hf:Qwen/Qwen2.5-3B-Instruct-GGUF:Q4_K_M',                label: 'Qwen 2.5 3B Q4',   description: '~2 GB · Better quality' },
  { uri: 'hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M',         label: 'Llama 3.2 3B',      description: '~2 GB · Meta model' },
  { uri: 'hf:bartowski/Phi-3.5-mini-instruct-GGUF:Q4_K_M',         label: 'Phi 3.5 Mini',      description: '~2.4 GB · Microsoft' },
  { uri: 'hf:TheBloke/Mistral-7B-Instruct-v0.2-GGUF:Q4_K_M',       label: 'Mistral 7B',        description: '~4.4 GB · High quality' },
  { uri: 'hf:TheBloke/CodeLlama-7B-Instruct-GGUF:Q4_K_M',          label: 'CodeLlama 7B',      description: '~4.1 GB · Code-focused' },
];

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

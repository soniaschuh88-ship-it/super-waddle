/**
 * src/lib/llm-client.ts
 *
 * Unified LLM client routing to four backends:
 *   webgpu      → @mlc-ai/web-llm (WebGPU, in-browser)
 *   mlc-server  → mlc_llm serve (OpenAI-compatible REST)
 *   llama-node  → bundled Express server/index.js (OpenAI-compatible REST)
 *   ollama      → Ollama local server (OpenAI-compatible REST + /api/tags, /api/pull)
 */
import type { BackendConfig, EngineProgress } from '@/types';
import { loadEngine, generateJson as wgJson, generateStreaming as wgStream, isEngineReady } from '@/lib/webllm';

// ── REST helpers ──────────────────────────────────────────────────────────────

async function restComplete(baseUrl: string, model: string, messages: {role:string;content:string}[], temperature=0.3, maxTokens=2048): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ model, messages, stream:false, temperature, max_tokens:maxTokens }),
  });
  if (!res.ok) throw new Error(`REST backend ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: Array<{message:{content:string}}> };
  return data.choices[0]?.message?.content ?? '';
}

async function restStream(baseUrl: string, model: string, messages: {role:string;content:string}[], onChunk:(c:string)=>void, temperature=0.4, maxTokens=4096): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ model, messages, stream:true, temperature, max_tokens:maxTokens }),
  });
  if (!res.ok) throw new Error(`REST backend ${res.status}: ${await res.text()}`);
  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader(); const decoder = new TextDecoder();
  let full='', buffer='';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream:true });
    const lines = buffer.split('\n'); buffer = lines.pop()??'';
    for (const line of lines) {
      const t = line.trim(); if (!t.startsWith('data:')) continue;
      const json = t.slice(5).trim(); if (json==='[DONE]') break;
      try {
        const chunk = JSON.parse(json) as { choices: Array<{delta:{content?:string}; finish_reason?:string}> };
        const d = chunk.choices[0]?.delta?.content??'';
        if (d) { full+=d; onChunk(d); }
      } catch { /**/ }
    }
  }
  return full;
}

// ── Public connectivity check ─────────────────────────────────────────────────

export async function pingRestBackend(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

// ── Ollama-specific APIs ──────────────────────────────────────────────────────

export interface OllamaModel { name: string; size: number; modified_at: string; }

/** List models available on a local Ollama server. */
export async function ollamaListModels(baseUrl: string): Promise<OllamaModel[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = await res.json() as { models: OllamaModel[] };
    return data.models ?? [];
  } catch { return []; }
}

/** Pull a model on the Ollama server, streaming progress via onProgress. */
export async function ollamaPullModel(baseUrl: string, modelName: string, onProgress: (status: string, pct: number) => void): Promise<void> {
  const res = await fetch(`${baseUrl}/api/pull`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name: modelName, stream: true }),
  });
  if (!res.ok) throw new Error(`Pull failed: ${await res.text()}`);
  const reader = res.body!.getReader(); const dec = new TextDecoder();
  let buf='';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream:true });
    const lines = buf.split('\n'); buf = lines.pop()??'';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { status:string; completed?:number; total?:number };
        const pct = obj.total ? Math.round((obj.completed??0)/obj.total*100) : 0;
        onProgress(obj.status, pct);
      } catch { /**/ }
    }
  }
}

/** Delete a model from the Ollama server. */
export async function ollamaDeleteModel(baseUrl: string, modelName: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/delete`, {
    method:'DELETE', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name: modelName }),
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

/** Popular Ollama models to recommend in the UI. */
export const OLLAMA_POPULAR_MODELS = [
  { name:'qwen2.5:1.5b',  label:'Qwen 2.5 1.5B',   description:'Fast, good quality' },
  { name:'qwen2.5:3b',    label:'Qwen 2.5 3B',      description:'Better quality' },
  { name:'llama3.2:1b',   label:'Llama 3.2 1B',     description:'Meta, very fast' },
  { name:'llama3.2:3b',   label:'Llama 3.2 3B',     description:'Meta, balanced' },
  { name:'mistral:7b',    label:'Mistral 7B',        description:'Strong reasoning' },
  { name:'codellama:7b',  label:'CodeLlama 7B',      description:'Code-focused' },
  { name:'phi3.5:mini',   label:'Phi 3.5 Mini',      description:'Microsoft, efficient' },
  { name:'gemma2:2b',     label:'Gemma 2 2B',        description:'Google, compact' },
];

// ── Unified public API ────────────────────────────────────────────────────────

export async function loadClient(config: BackendConfig, onProgress: (p:EngineProgress)=>void): Promise<void> {
  if (config.type === 'webgpu') return loadEngine(config.modelId, onProgress);
  onProgress({ progress:10, text:`Connecting to ${config.serverUrl}…` });
  const ok = await pingRestBackend(config.serverUrl);
  if (!ok) throw new Error(`Cannot reach ${config.type} server at ${config.serverUrl}. Make sure it is running.`);
  onProgress({ progress:100, text:'Server reachable.' });
}

export function isClientReady(config: BackendConfig): boolean {
  return config.type === 'webgpu' ? isEngineReady() : config.serverUrl.length > 0;
}

export async function generateJson<T>(system: string, user: string, config: BackendConfig): Promise<T | null> {
  if (config.type === 'webgpu') return wgJson<T>(system, user);
  const raw = await restComplete(config.serverUrl, config.modelId, [
    { role:'system', content:system }, { role:'user', content:user },
  ], 0.3, 2048);
  const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  try { return JSON.parse(cleaned) as T; } catch { console.error('[llm-client] parse fail:', raw); return null; }
}

export async function generateStreaming(system: string, user: string, onChunk:(c:string)=>void, maxTokens:number, config: BackendConfig): Promise<string> {
  if (config.type === 'webgpu') return wgStream(system, user, onChunk, maxTokens);
  return restStream(config.serverUrl, config.modelId, [
    { role:'system', content:system }, { role:'user', content:user },
  ], onChunk, 0.4, maxTokens);
}

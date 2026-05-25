/**
 * src/lib/webllm.ts – WebGPU inference via @mlc-ai/web-llm Web Worker.
 */
import { WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import type { EngineProgress } from '@/types';

export interface ModelOption {
  id: string; label: string; sizeMb: number; description: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',  label: 'Qwen 2.5 – 0.5B (Fastest)',       sizeMb: 390,  description: 'Smallest model, very fast, basic quality.' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',  label: 'Qwen 2.5 – 1.5B (Recommended)',   sizeMb: 950,  description: 'Best balance of speed and quality.' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',    label: 'Qwen 2.5 – 3B (High Quality)',    sizeMb: 1800, description: 'Better plans, slower inference.' },
  { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',  label: 'SmolLM 2 – 360M (Ultra Fast)',    sizeMb: 210,  description: 'Extremely fast, short plans.' },
  { id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',  label: 'SmolLM 2 – 1.7B',                sizeMb: 1000, description: 'Good speed/quality tradeoff.' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',  label: 'Phi 3.5 Mini (Microsoft)',        sizeMb: 2200, description: 'Strong reasoning, larger download.' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',  label: 'Llama 3.2 – 1B (Meta)',           sizeMb: 700,  description: 'Meta small model, fast.' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',  label: 'Llama 3.2 – 3B (Meta)',           sizeMb: 1900, description: 'Meta 3B model, good quality.' },
  { id: 'Qwen3-1.7B-q4f16_1-MLC',             label: 'Qwen 3 – 1.7B (Latest)',          sizeMb: 1100, description: 'Newest Qwen generation.' },
];

export const DEFAULT_MODEL_ID = MODEL_OPTIONS[1].id;

let _engine: WebWorkerMLCEngine | null = null;
let _loadedModelId: string | null = null;

export async function loadEngine(modelId: string, onProgress: (p: EngineProgress) => void): Promise<void> {
  if (!_engine) {
    const WorkerCtor = (await import('@/workers/webllm.worker?worker')).default as new () => Worker;
    _engine = new WebWorkerMLCEngine(new WorkerCtor());
  }
  if (_loadedModelId === modelId) { onProgress({ progress: 100, text: 'Model ready.' }); return; }
  _engine.setInitProgressCallback(r => onProgress({ progress: Math.round(r.progress * 100), text: r.text }));
  await _engine.reload(modelId);
  _loadedModelId = modelId;
}

export function isEngineReady(): boolean { return _engine !== null && _loadedModelId !== null; }

function getEngine(): WebWorkerMLCEngine {
  if (!_engine || !_loadedModelId) throw new Error('LLM engine not loaded. Call loadEngine() first.');
  return _engine;
}

export async function generateJson<T>(system: string, user: string): Promise<T | null> {
  const r = await getEngine().chat.completions.create({
    stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.3, max_tokens: 2048,
  });
  const raw = r.choices[0]?.message?.content ?? '';
  const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  try { return JSON.parse(cleaned) as T; } catch { console.error('[webllm] parse fail:', raw); return null; }
}

export async function generateStreaming(system: string, user: string, onChunk: (c: string) => void, maxTokens = 4096): Promise<string> {
  const stream = await getEngine().chat.completions.create({
    stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.4, max_tokens: maxTokens,
  });
  let full = '';
  for await (const chunk of stream) {
    const d = chunk.choices[0]?.delta?.content ?? '';
    if (d) { full += d; onChunk(d); }
  }
  return full;
}

/** Pre-cache a model without using it for inference. */
export async function precacheModel(modelId: string, onProgress: (p: EngineProgress) => void): Promise<void> {
  return loadEngine(modelId, onProgress);
}

/** Return IDs of models that are already cached in the browser. */
export async function getCachedModelIds(): Promise<string[]> {
  try {
    const cache = await caches.open('webllm-model-cache');
    const keys = await cache.keys();
    const cached: string[] = [];
    for (const m of MODEL_OPTIONS) {
      if (keys.some(k => k.url.includes(m.id))) cached.push(m.id);
    }
    return cached;
  } catch { return []; }
}

/** Delete a specific model from the browser cache. */
export async function deleteCachedModel(modelId: string): Promise<void> {
  try {
    const cache = await caches.open('webllm-model-cache');
    const keys = await cache.keys();
    for (const k of keys) {
      if (k.url.includes(modelId)) await cache.delete(k);
    }
  } catch { /* ignore */ }
}

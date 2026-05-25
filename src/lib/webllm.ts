/**
 * src/lib/webllm.ts
 *
 * WebGPU in-browser inference via @mlc-ai/web-llm.
 * Uses CreateWebWorkerMLCEngine so the heavy WASM/WebGPU work stays off the
 * main thread.  The worker (webllm.worker.ts) hosts a WebWorkerMLCEngineHandler.
 *
 * Real API — no simulation.  All functions talk to the actual engine.
 */

import {
  CreateWebWorkerMLCEngine,
  hasModelInCache,
  deleteModelAllInfoInCache,
  type WebWorkerMLCEngine,
  type InitProgressReport,
} from '@mlc-ai/web-llm';
import type { EngineProgress } from '@/types';

// ── Model catalogue ───────────────────────────────────────────────────────────

export interface ModelOption {
  id:          string;
  label:       string;
  sizeMb:      number;
  /** Approximate parameter count in billions (used for size filtering). */
  sizeB:       number;
  description: string;
  family:      string;
}

/** Models available in this version of web-llm. */
export const MODEL_OPTIONS: ModelOption[] = [
  { id:'SmolLM2-360M-Instruct-q4f16_1-MLC',  label:'SmolLM 2 – 360M',         sizeMb:210,  sizeB:0.36, family:'SmolLM', description:'Fastest; very short plans.' },
  { id:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',  label:'Qwen 2.5 – 0.5B',         sizeMb:390,  sizeB:0.5,  family:'Qwen',   description:'Tiny Qwen, great on low-end GPUs.' },
  { id:'Llama-3.2-1B-Instruct-q4f32_1-MLC',  label:'Llama 3.2 – 1B (Meta) ★', sizeMb:700,  sizeB:1.0,  family:'Llama',  description:'Recommended 1B — fast & good quality.' },
  { id:'SmolLM2-1.7B-Instruct-q4f16_1-MLC',  label:'SmolLM 2 – 1.7B',         sizeMb:1000, sizeB:1.7,  family:'SmolLM', description:'Good balance for small GPUs.' },
  { id:'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',  label:'Qwen 2.5 – 1.5B',         sizeMb:950,  sizeB:1.5,  family:'Qwen',   description:'Fast & good quality.' },
  { id:'Qwen3-1.7B-q4f16_1-MLC',             label:'Qwen 3 – 1.7B (latest)',   sizeMb:1100, sizeB:1.7,  family:'Qwen3',  description:'Newest Qwen, thinking mode.' },
  { id:'Qwen2.5-3B-Instruct-q4f16_1-MLC',    label:'Qwen 2.5 – 3B',           sizeMb:1800, sizeB:3.0,  family:'Qwen',   description:'Better plans, slower.' },
  { id:'Llama-3.2-3B-Instruct-q4f16_1-MLC',  label:'Llama 3.2 – 3B (Meta)',   sizeMb:1900, sizeB:3.0,  family:'Llama',  description:'Meta 3B.' },
  { id:'Phi-3.5-mini-instruct-q4f16_1-MLC',  label:'Phi 3.5 Mini (Microsoft)', sizeMb:2200, sizeB:3.8,  family:'Phi',    description:'Strong reasoning.' },
];

export const DEFAULT_MODEL_ID = MODEL_OPTIONS[2].id; // Llama 3.2 1B

// ── Engine singleton ──────────────────────────────────────────────────────────

let _engine:        WebWorkerMLCEngine | null = null;
let _loadedModelId: string | null             = null;
let _loading        = false;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load (or switch to) a model.  Progress is reported via onProgress (0–100).
 * Safe to call multiple times — returns immediately if the model is already loaded.
 */
export async function loadEngine(
  modelId:    string,
  onProgress: (p: EngineProgress) => void,
): Promise<void> {
  if (_loadedModelId === modelId && _engine) {
    onProgress({ progress: 100, text: 'Model already loaded.' });
    return;
  }
  if (_loading) {
    throw new Error('Engine is already loading. Wait for the current load to finish.');
  }
  _loading = true;

  try {
    // Terminate previous worker if switching models
    if (_engine) {
      _engine = null;
      _loadedModelId = null;
    }

    const WorkerCtor = (
      await import('@/workers/webllm.worker?worker')
    ).default as new () => Worker;

    _engine = await CreateWebWorkerMLCEngine(
      new WorkerCtor(),
      modelId,
      {
        initProgressCallback: (report: InitProgressReport) => {
          onProgress({
            progress: Math.round(report.progress * 100),
            text:     report.text,
          });
        },
      },
    );

    _loadedModelId = modelId;
  } finally {
    _loading = false;
  }
}

/** True when an engine is loaded and ready. */
export function isEngineReady(): boolean {
  return _engine !== null && _loadedModelId !== null && !_loading;
}

/** ID of the currently loaded model, or null. */
export function loadedModelId(): string | null {
  return _loadedModelId;
}

// ── Inference ─────────────────────────────────────────────────────────────────

function requireEngine(): WebWorkerMLCEngine {
  if (!_engine || !_loadedModelId) {
    throw new Error('WebLLM engine not loaded. Call loadEngine() first.');
  }
  return _engine;
}

/**
 * Generate structured JSON (non-streaming).
 * Strips markdown code fences before parsing.
 */
export async function generateJson<T>(
  systemPrompt: string,
  userPrompt:   string,
): Promise<T | null> {
  const engine = requireEngine();

  const resp = await engine.chat.completions.create({
    stream:      false,
    messages:    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ],
    temperature: 0.2,
    max_tokens:  2048,
  });

  const raw = resp.choices[0]?.message?.content ?? '';
  const clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(clean) as T;
  } catch {
    console.error('[webllm] JSON parse failed. Raw output:', raw.slice(0, 400));
    return null;
  }
}

/**
 * Stream-generate a document.
 * Calls onChunk with each incremental text delta.
 * Returns the full accumulated text when done.
 */
export async function generateStreaming(
  systemPrompt: string,
  userPrompt:   string,
  onChunk:      (chunk: string) => void,
  maxTokens     = 4096,
): Promise<string> {
  const engine = requireEngine();

  const stream = await engine.chat.completions.create({
    stream:      true,
    messages:    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ],
    temperature: 0.4,
    max_tokens:  maxTokens,
  });

  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (delta) {
      full += delta;
      onChunk(delta);
    }
  }
  return full;
}

// ── Cache management ──────────────────────────────────────────────────────────

/** Check which models are already downloaded to the browser cache. */
export async function getCachedModelIds(): Promise<string[]> {
  const results = await Promise.allSettled(
    MODEL_OPTIONS.map(async (m) => ({ id: m.id, cached: await hasModelInCache(m.id) })),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ id: string; cached: boolean }> =>
      r.status === 'fulfilled' && r.value.cached,
    )
    .map((r) => r.value.id);
}

/**
 * Pre-cache a model without running inference on it.
 * Shows download progress via onProgress.
 */
export async function precacheModel(
  modelId:    string,
  onProgress: (p: EngineProgress) => void,
): Promise<void> {
  return loadEngine(modelId, onProgress);
}

/** Remove a model from the browser cache. */
export async function deleteCachedModel(modelId: string): Promise<void> {
  await deleteModelAllInfoInCache(modelId);
  if (_loadedModelId === modelId) {
    _engine        = null;
    _loadedModelId = null;
  }
}

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

// ── Re-export types used by callers ───────────────────────────────────────────

export interface ChatTool {
  type: 'function';
  function: {
    name:        string;
    description: string;
    parameters:  Record<string, unknown>; // JSON Schema object
  };
}

export interface StreamingOptions {
  temperature?: number;
  maxTokens?:   number;
  seed?:        number;
  tools?:       ChatTool[];
}

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

/** True while a model is currently loading. */
export function isEngineLoading(): boolean {
  return _loading;
}

/** ID of the currently loaded model, or null. */
export function loadedModelId(): string | null {
  return _loadedModelId;
}

// ── Auto-load ─────────────────────────────────────────────────────────────────

/**
 * Ensure the engine is loaded, auto-loading the default model if it isn't.
 * Pass an `onProgress` callback to receive download/init progress.
 *
 * Any component that wants to use WebLLM features without going through the
 * wizard can call this directly (e.g. the Embeddings Lab in the admin panel).
 */
export async function ensureEngine(
  modelId   = DEFAULT_MODEL_ID,
  onProgress: (p: EngineProgress) => void = () => {},
): Promise<void> {
  if (isEngineReady() && _loadedModelId === modelId) {
    onProgress({ progress: 100, text: 'Model already loaded.' });
    return;
  }
  return loadEngine(modelId, onProgress);
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Strict check — throws immediately if engine not loaded.
 * Used internally where we need synchronous access.
 */
function requireEngine(): WebWorkerMLCEngine {
  if (!_engine || !_loadedModelId) {
    throw new Error(
      'WebLLM engine not loaded. ' +
      'Call loadEngine() or ensureEngine() first, or use a REST backend (Ollama / node-llama-cpp).',
    );
  }
  return _engine;
}

/**
 * Lazy engine accessor — auto-loads the default model if not ready.
 * All public inference functions use this so callers never see
 * the "not loaded" error; instead they wait for the download.
 *
 * Pass `onProgress` if you want to surface download progress.
 */
async function getOrLoadEngine(
  onProgress?: (p: EngineProgress) => void,
): Promise<WebWorkerMLCEngine> {
  if (!isEngineReady()) {
    await ensureEngine(DEFAULT_MODEL_ID, onProgress ?? (() => {}));
  }
  return requireEngine();
}

/**
 * Generate structured JSON (non-streaming).
 * Strips markdown code fences before parsing.
 */
export async function generateJson<T>(
  systemPrompt: string,
  userPrompt:   string,
  onProgress?:  (p: EngineProgress) => void,
): Promise<T | null> {
  const engine = await getOrLoadEngine(onProgress);

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
  onProgress?:  (p: EngineProgress) => void,
): Promise<string> {
  const engine = await getOrLoadEngine(onProgress);

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

// ── Text completion (no chat template) ───────────────────────────────────────

/**
 * Raw text completion — uses `engine.completions.create()`, no chat template.
 * Good for fill-in, autocomplete, and code generation tasks.
 *
 * @example
 *   const result = await generateTextCompletion('function add(a, b) {', { maxTokens: 64 });
 */
export async function generateTextCompletion(
  prompt:      string,
  opts:        { maxTokens?: number; temperature?: number; seed?: number } = {},
  onChunk?:    (chunk: string) => void,
  onProgress?: (p: EngineProgress) => void,
): Promise<string> {
  const engine = await getOrLoadEngine(onProgress);

  if (onChunk) {
    const stream = await engine.completions.create({
      prompt,
      stream:      true,
      max_tokens:  opts.maxTokens  ?? 256,
      temperature: opts.temperature ?? 0.4,
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    });
    let full = '';
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.text ?? '';
      if (text) { full += text; onChunk(text); }
    }
    return full;
  }

  const resp = await engine.completions.create({
    prompt,
    stream:      false,
    max_tokens:  opts.maxTokens  ?? 256,
    temperature: opts.temperature ?? 0.4,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  });
  return resp.choices[0]?.text ?? '';
}

// ── Embeddings ────────────────────────────────────────────────────────────────

/**
 * Create embedding vectors for one or more texts.
 * Uses `engine.embeddings.create()` from web-llm.
 *
 * @returns Array of float32 arrays, one per input text.
 */
export async function createEmbeddings(
  texts:       string[],
  onProgress?: (p: EngineProgress) => void,
): Promise<number[][]> {
  const engine = await getOrLoadEngine(onProgress);
  const resp   = await engine.embeddings.create({
    input: texts,
    model: _loadedModelId ?? '',
  });
  return resp.data
    .sort((a, b) => a.index - b.index)
    .map(e => e.embedding as number[]);
}

/**
 * Compute cosine similarity between two texts.
 * Returns a value in [0, 1] where 1 = identical meaning.
 */
export async function computeSemanticSimilarity(
  text1:       string,
  text2:       string,
  onProgress?: (p: EngineProgress) => void,
): Promise<number> {
  const [v1, v2] = await createEmbeddings([text1, text2], onProgress);
  return cosineSimilarity(v1, v2);
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Function calling ──────────────────────────────────────────────────────────

export interface ToolCallResult {
  name:       string;
  arguments:  Record<string, unknown>;
  /** Result returned by the handler. */
  result:     unknown;
}

/**
 * Chat completion with tool/function calling.
 *
 * Handlers are provided as a map { [toolName]: (args) => any }.
 * When the model calls a function, the handler runs and the result is fed
 * back to the model so it can incorporate it in its final answer.
 *
 * @returns { answer, toolCalls } — final text response plus log of all calls.
 */
export async function generateWithTools(
  messages:  Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  tools:     ChatTool[],
  handlers:  Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>,
  opts:      { temperature?: number; maxTokens?: number; seed?: number } = {},
): Promise<{ answer: string; toolCalls: ToolCallResult[] }> {
  const engine    = await getOrLoadEngine();
  const toolCalls: ToolCallResult[] = [];
  const allMessages = [...messages];

  // First pass: get the model's initial response (may include tool calls)
  const firstResp = await engine.chat.completions.create({
    stream:      false,
    messages:    allMessages as Parameters<typeof engine.chat.completions.create>[0]['messages'],
    tools:       tools as Parameters<typeof engine.chat.completions.create>[0]['tools'],
    temperature: opts.temperature ?? 0.3,
    max_tokens:  opts.maxTokens   ?? 2048,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  });

  const firstChoice = firstResp.choices[0];
  const finishReason = firstChoice?.finish_reason;

  // If the model issued tool calls, execute them and continue
  if (finishReason === 'tool_calls' && firstChoice?.message?.tool_calls) {
    allMessages.push({ role: 'assistant', content: firstChoice.message.content ?? '' });

    for (const tc of firstChoice.message.tool_calls) {
      const fn      = tc.function;
      const handler = handlers[fn.name];
      let result: unknown = `Tool "${fn.name}" not found`;

      if (handler) {
        try {
          const args = JSON.parse(fn.arguments ?? '{}') as Record<string, unknown>;
          result     = await handler(args);
          toolCalls.push({ name: fn.name, arguments: args, result });
        } catch (e) {
          result = `Error: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      }

      // Append tool result back to the conversation
      allMessages.push({
        role:        'tool' as unknown as 'user', // web-llm may support 'tool' role
        content:     typeof result === 'string' ? result : JSON.stringify(result),
      });
    }

    // Second pass: model incorporates tool results into final answer
    const finalResp = await engine.chat.completions.create({
      stream:      false,
      messages:    allMessages as Parameters<typeof engine.chat.completions.create>[0]['messages'],
      temperature: opts.temperature ?? 0.3,
      max_tokens:  opts.maxTokens   ?? 2048,
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    });

    return {
      answer:    finalResp.choices[0]?.message?.content ?? '',
      toolCalls,
    };
  }

  return {
    answer:    firstChoice?.message?.content ?? '',
    toolCalls,
  };
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

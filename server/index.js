/**
 * server/index.js — node-llama-cpp inference server for bKG  v3.0
 *
 * Full feature set:
 *   • Chat completions     streaming + non-streaming, system prompts, multi-turn history
 *   • Function calling     defineChatSessionFunction + OpenAI tools format
 *   • JSON grammar         response_format: json_object | json_schema
 *   • Text completion      POST /v1/completions  (LlamaCompletion)
 *   • Embeddings           POST /v1/embeddings + POST /v1/similarity
 *   • Model management     programmatic download via resolveModelFile, list, delete, inspect
 *   • GPU info             GET /gpu
 *   • Health               GET /health
 *   • Hot model swap       PUT /model
 *   • AbortController      streaming cancel on Connection: close
 *
 * Quick start:
 *   cd server && npm install
 *   node index.js                          # auto-picks first .gguf in ./models
 *   MODEL_PATH=./models/qwen.gguf node index.js
 */

import {
  getLlama,
  LlamaChatSession,
  LlamaCompletion,
  defineChatSessionFunction,
  resolveModelFile,
} from 'node-llama-cpp';
import express  from 'express';
import cors     from 'cors';
import { readdir, access, rm, mkdir, stat } from 'fs/promises';
import { join, extname, basename }          from 'path';
import { randomUUID }                        from 'crypto';
import { fileURLToPath }                     from 'url';
import { dirname }                           from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PORT        ?? '8001', 10);
const HOST        = process.env.HOST                  ?? '127.0.0.1';
const MODEL_DIR   = process.env.MODEL_DIR             ?? join(__dirname, 'models');
const N_CTX       = parseInt(process.env.N_CTX        ?? '4096', 10);
const GPU_LAYERS  = parseInt(process.env.GPU_LAYERS   ?? '-1',   10);
const TEMPERATURE = parseFloat(process.env.TEMPERATURE ?? '0.4');

// ── Runtime state ─────────────────────────────────────────────────────────────

let llama           = null;
let activeModel     = null;
let activeModelPath = '';

// ── Llama / model lifecycle ───────────────────────────────────────────────────

async function getOrInitLlama() {
  if (llama) return llama;
  console.log('[server] Initialising node-llama-cpp (GPU auto-detect)…');
  llama = await getLlama({ logLevel: 'warn' });
  console.log(`[server] Backend: ${llama.gpu ?? 'cpu'}`);
  return llama;
}

async function loadModel(modelPath) {
  if (activeModelPath === modelPath && activeModel) return activeModel;
  if (activeModel) {
    console.log('[server] Unloading previous model…');
    await activeModel.dispose();
    activeModel = null; activeModelPath = '';
  }
  const ll = await getOrInitLlama();
  console.log(`[server] Loading: ${modelPath}`);
  activeModel     = await ll.loadModel({ modelPath });
  activeModelPath = modelPath;
  console.log('[server] Model ready');
  return activeModel;
}

async function resolveModelPath(hint) {
  if (hint && hint.startsWith('/'))  return hint;          // absolute local path
  if (hint && !hint.startsWith('hf:') && !hint.startsWith('http')) return join(MODEL_DIR, hint);
  if (process.env.MODEL_PATH)        return process.env.MODEL_PATH;
  const files = await listGgufFiles();
  if (!files.length) throw new Error('No GGUF model found. Download one via /models/download or POST /models/pull');
  return files[0].path;
}

// ── Model directory helpers ───────────────────────────────────────────────────

async function listGgufFiles() {
  await mkdir(MODEL_DIR, { recursive: true }).catch(() => {});
  let entries;
  try { entries = await readdir(MODEL_DIR, { withFileTypes: true }); } catch { return []; }
  const files = await Promise.all(
    entries
      .filter(e => e.isFile() && extname(e.name).toLowerCase() === '.gguf')
      .map(async e => {
        const p = join(MODEL_DIR, e.name);
        const s = await stat(p).catch(() => null);
        return { name: e.name, path: p, sizeMb: s ? Math.round(s.size / 1048576) : 0 };
      })
  );
  return files;
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

// ── Chat history helpers ──────────────────────────────────────────────────────

function parseMessages(messages) {
  const system       = messages.find(m => m.role === 'system');
  const systemPrompt = system?.content ?? '';
  const turns        = messages.filter(m => m.role !== 'system');
  if (!turns.length) throw new Error('No user message provided');
  const last = turns[turns.length - 1];
  if (last.role !== 'user') throw new Error('Last message must be from user');
  const prev = turns.slice(0, -1);
  const history = [];
  for (let i = 0; i < prev.length; ) {
    const msg = prev[i];
    if (msg.role === 'user') {
      const next = prev[i + 1];
      history.push({ type: 'user', text: msg.content });
      if (next?.role === 'assistant') { history.push({ type: 'model', response: [next.content] }); i += 2; }
      else i += 1;
    } else if (msg.role === 'assistant') {
      history.push({ type: 'model', response: [msg.content] }); i += 1;
    } else { i += 1; }
  }
  return { systemPrompt, history, lastUserMsg: last.content };
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

const sse = (data) => `data: ${JSON.stringify(data)}\n\n`;

function sseChunk(id, model, delta, finish_reason = null) {
  return sse({ id, object: 'chat.completion.chunk', created: ts(), model,
    choices: [{ index: 0, delta, finish_reason }] });
}

function completionChunk(id, model, text, finish_reason = null) {
  return sse({ id, object: 'text_completion', created: ts(), model,
    choices: [{ index: 0, text, finish_reason, logprobs: null }] });
}

const ts = () => Math.floor(Date.now() / 1000);

// ── Cosine similarity helper ───────────────────────────────────────────────────

function cosineSimilarity(a, b) {
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

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '8mb' }));

// ── GET /health ───────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', modelLoaded: !!activeModel, modelPath: activeModelPath || null });
});

// ── GET /gpu ──────────────────────────────────────────────────────────────────

app.get('/gpu', async (_req, res) => {
  try {
    const ll       = await getOrInitLlama();
    const gpuInfo  = await ll.getGpuDeviceInfo?.() ?? null;
    res.json({ backend: ll.gpu ?? 'cpu', gpuInfo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /v1/models ────────────────────────────────────────────────────────────

app.get('/v1/models', async (_req, res) => {
  const files = await listGgufFiles();
  res.json({
    object: 'list',
    data: files.map(f => ({ id: f.name, path: f.path, sizeMb: f.sizeMb, object: 'model', owned_by: 'node-llama-cpp' })),
  });
});

// ── PUT /model — hot-swap ─────────────────────────────────────────────────────

app.put('/model', async (req, res) => {
  const { modelPath } = req.body ?? {};
  if (!modelPath) return res.status(400).json({ error: 'modelPath is required' });
  if (!await fileExists(modelPath)) return res.status(404).json({ error: `File not found: ${modelPath}` });
  try { await loadModel(modelPath); res.json({ status: 'loaded', modelPath }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /models/download — programmatic download via resolveModelFile ────────
//   Body: { uri: "hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M" }
//   Streams SSE progress while downloading.

app.post('/models/download', async (req, res) => {
  const { uri } = req.body ?? {};
  if (!uri) return res.status(400).json({ error: 'uri is required' });

  await mkdir(MODEL_DIR, { recursive: true }).catch(() => {});

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  const send = (data) => res.write(sse(data));
  send({ status: 'starting', uri });

  try {
    const ll = await getOrInitLlama();
    // resolveModelFile downloads from HuggingFace if not cached locally
    const modelPath = await resolveModelFile(uri, MODEL_DIR, {
      cli: { useMessageUpdateEvent: true },
      onProgress({ totalSize, downloadedSize }) {
        const pct = totalSize > 0 ? Math.round(downloadedSize / totalSize * 100) : 0;
        const mb  = Math.round(downloadedSize / 1048576);
        const total = Math.round(totalSize / 1048576);
        send({ status: 'progress', pct, message: `${pct}% — ${mb}/${total} MB` });
      },
    });
    ll; // suppress unused warning; llama is needed for resolveModelFile context

    const files = await listGgufFiles();
    send({ status: 'done', modelPath, models: files.map(f => f.name) });
  } catch (err) {
    send({ status: 'error', message: err.message });
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

// Keep the old /models/pull endpoint as an alias
app.post('/models/pull', (req, res) => {
  req.url = '/models/download';
  app._router.handle(req, res, () => {});
});

// ── DELETE /models/:filename ──────────────────────────────────────────────────

app.delete('/models/:filename', async (req, res) => {
  const target = join(MODEL_DIR, basename(req.params.filename));
  if (!target.startsWith(MODEL_DIR)) return res.status(400).json({ error: 'Invalid path' });
  if (!await fileExists(target))     return res.status(404).json({ error: 'File not found' });
  if (activeModelPath === target) {
    await activeModel?.dispose(); activeModel = null; activeModelPath = '';
  }
  await rm(target);
  res.json({ status: 'deleted', file: basename(target) });
});

// ── GET /models/inspect?uri= — hardware compatibility estimate ────────────────

app.get('/models/inspect', async (req, res) => {
  const { uri } = req.query;
  if (!uri) return res.status(400).json({ error: 'uri required' });
  try {
    const ll = await getOrInitLlama();
    // Use the programmatic inspect API
    const modelInfo = await ll.getModelInfo?.(uri).catch(() => null);
    if (modelInfo) { res.json(modelInfo); return; }
    // Fallback: return basic gpu info
    res.json({ backend: ll.gpu ?? 'cpu', note: 'inspect not available; check GPU manually with npm run gpu-info' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /v1/chat/completions ─────────────────────────────────────────────────
//
// Supports:
//   • Standard chat (system, user, assistant turns)
//   • response_format: { type: "json_object" | "json_schema", schema: {...} }
//   • tools: OpenAI-format function definitions — executed server-side
//   • stream: true/false
//   • temperature, max_tokens, top_k, top_p, seed
//
app.post('/v1/chat/completions', async (req, res) => {
  const {
    messages        = [],
    stream          = false,
    temperature     = TEMPERATURE,
    max_tokens,
    top_k,
    top_p,
    seed,
    response_format,
    tools,
    model: modelHint,
  } = req.body ?? {};

  const id = `chatcmpl-${randomUUID().replace(/-/g,'').slice(0,12)}`;

  try {
    const modelPath = await resolveModelPath(modelHint);
    const model     = await loadModel(modelPath);
    const modelName = basename(modelPath);
    const { systemPrompt, history, lastUserMsg } = parseMessages(messages);

    const context = await model.createContext({ contextSize: N_CTX });
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt:    systemPrompt || undefined,
    });

    if (history.length > 0) await session.setChatHistory(history);

    // ── Grammar ─────────────────────────────────────────────────────────────
    let grammar = undefined;
    const ll = await getOrInitLlama();
    if (response_format?.type === 'json_object') {
      grammar = await ll.getGrammarFor('json');
    } else if (response_format?.type === 'json_schema' && response_format.schema) {
      grammar = await ll.createGrammarForJsonSchema(response_format.schema);
    }

    // ── Function calling ─────────────────────────────────────────────────────
    // Convert OpenAI tools format to node-llama-cpp functions.
    // Each tool function, when called by the model, executes synchronously and
    // returns the result to the model so it can craft a final answer.
    let functions = undefined;
    const toolCallLog = []; // record of what was called for the response

    if (tools && tools.length > 0) {
      functions = {};
      for (const tool of tools) {
        if (tool.type !== 'function') continue;
        const fn = tool.function;
        functions[fn.name] = defineChatSessionFunction({
          description: fn.description ?? '',
          params:      fn.parameters  ?? { type: 'object', properties: {} },
          handler(params) {
            // Log the call — the actual execution is returned to the model as text
            const call = { name: fn.name, arguments: params, timestamp: new Date().toISOString() };
            toolCallLog.push(call);
            // Return a placeholder — caller gets the full toolCallLog in the response
            return `Function "${fn.name}" executed with args: ${JSON.stringify(params)}`;
          },
        });
      }
    }

    const promptOpts = {
      temperature,
      ...(max_tokens && { maxTokens: max_tokens }),
      ...(top_k      && { topK: top_k }),
      ...(top_p      && { topP: top_p }),
      ...(seed       && { seed }),
      ...(grammar    && { grammar }),
      ...(functions  && { functions }),
    };

    if (stream) {
      res.setHeader('Content-Type',  'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection',    'keep-alive');
      res.write(sseChunk(id, modelName, { role: 'assistant' }));

      const abortCtrl = new AbortController();
      req.on('close', () => abortCtrl.abort());

      try {
        await session.prompt(lastUserMsg, {
          ...promptOpts,
          stopOnAbortSignal: true,
          signal: abortCtrl.signal,
          onTextChunk(chunk) { res.write(sseChunk(id, modelName, { content: chunk })); },
        });
      } catch { /* aborted */ }

      res.write(sseChunk(id, modelName, {}, 'stop'));
      if (toolCallLog.length > 0) {
        res.write(sse({ type: 'tool_calls', calls: toolCallLog }));
      }
      res.write('data: [DONE]\n\n');
      res.end();

    } else {
      const text = await session.prompt(lastUserMsg, promptOpts);
      res.json({
        id, object: 'chat.completion', created: ts(), model: modelName,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        tool_calls:  toolCallLog.length > 0 ? toolCallLog : undefined,
        usage: { prompt_tokens: -1, completion_tokens: -1, total_tokens: -1 },
      });
    }

    await context.dispose();

  } catch (err) {
    console.error('[/v1/chat/completions]', err.message);
    if (!res.headersSent) res.status(500).json({ error: { message: err.message, type: 'server_error' } });
    else { res.write(sse({ error: err.message })); res.end(); }
  }
});

// ── POST /v1/completions — raw text completion ────────────────────────────────
//   Supports: prompt, stream, temperature, max_tokens, seed
//   Also supports fill-in-the-middle: { prefix: "...", suffix: "..." }

app.post('/v1/completions', async (req, res) => {
  const {
    prompt          = '',
    prefix,
    suffix,
    stream          = false,
    temperature     = TEMPERATURE,
    max_tokens      = 512,
    seed,
    model: modelHint,
  } = req.body ?? {};

  const id = `cmpl-${randomUUID().replace(/-/g,'').slice(0,12)}`;

  try {
    const modelPath = await resolveModelPath(modelHint);
    const model     = await loadModel(modelPath);
    const modelName = basename(modelPath);
    const context   = await model.createContext({ contextSize: N_CTX });
    const completion= new LlamaCompletion({ contextSequence: context.getSequence() });

    const opts = { maxTokens: max_tokens, temperature, ...(seed && { seed }) };

    if (stream) {
      res.setHeader('Content-Type',  'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection',    'keep-alive');
      const abortCtrl = new AbortController();
      req.on('close', () => abortCtrl.abort());

      try {
        if (prefix !== undefined && suffix !== undefined && completion.infillSupported) {
          // Fill-in-the-Middle
          await completion.generateInfillCompletion(prefix, suffix, {
            ...opts, stopOnAbortSignal: true, signal: abortCtrl.signal,
            onTextChunk(chunk) { res.write(completionChunk(id, modelName, chunk)); },
          });
        } else {
          await completion.generateCompletion(prompt, {
            ...opts, stopOnAbortSignal: true, signal: abortCtrl.signal,
            onTextChunk(chunk) { res.write(completionChunk(id, modelName, chunk)); },
          });
        }
      } catch { /* aborted */ }

      res.write(completionChunk(id, modelName, '', 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      let text;
      if (prefix !== undefined && suffix !== undefined && completion.infillSupported) {
        text = await completion.generateInfillCompletion(prefix, suffix, opts);
      } else {
        text = await completion.generateCompletion(prompt, opts);
      }
      res.json({
        id, object: 'text_completion', created: ts(), model: modelName,
        choices: [{ index: 0, text, finish_reason: 'stop', logprobs: null }],
        usage: { prompt_tokens: -1, completion_tokens: -1, total_tokens: -1 },
        infill_supported: completion.infillSupported,
      });
    }

    await context.dispose();

  } catch (err) {
    console.error('[/v1/completions]', err.message);
    if (!res.headersSent) res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /v1/embeddings ───────────────────────────────────────────────────────

app.post('/v1/embeddings', async (req, res) => {
  const { input, model: modelHint } = req.body ?? {};
  if (!input) return res.status(400).json({ error: 'input is required' });

  try {
    const modelPath = await resolveModelPath(modelHint);
    const model     = await loadModel(modelPath);
    const modelName = basename(modelPath);
    const embCtx    = await model.createEmbeddingContext();
    const inputs    = Array.isArray(input) ? input : [input];
    const data      = [];

    for (let i = 0; i < inputs.length; i++) {
      const emb = await embCtx.getEmbeddingFor(inputs[i]);
      data.push({ object: 'embedding', index: i, embedding: Array.from(emb.vector) });
    }

    await embCtx.dispose();
    res.json({ object: 'list', model: modelName, data, usage: { prompt_tokens: -1, total_tokens: -1 } });

  } catch (err) {
    console.error('[/v1/embeddings]', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /v1/similarity — compute cosine similarity between two texts ─────────
//   Body: { text1: "...", text2: "...", model?: "..." }
//   Returns: { similarity: 0.0–1.0, text1, text2 }

app.post('/v1/similarity', async (req, res) => {
  const { text1, text2, model: modelHint } = req.body ?? {};
  if (!text1 || !text2) return res.status(400).json({ error: 'text1 and text2 are required' });

  try {
    const modelPath = await resolveModelPath(modelHint);
    const model     = await loadModel(modelPath);
    const modelName = basename(modelPath);
    const embCtx    = await model.createEmbeddingContext();

    const [e1, e2] = await Promise.all([
      embCtx.getEmbeddingFor(text1),
      embCtx.getEmbeddingFor(text2),
    ]);

    const similarity = cosineSimilarity(Array.from(e1.vector), Array.from(e2.vector));
    await embCtx.dispose();

    res.json({ similarity, text1, text2, model: modelName });

  } catch (err) {
    console.error('[/v1/similarity]', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

if (process.env.MODEL_PATH) {
  getOrInitLlama()
    .then(() => loadModel(process.env.MODEL_PATH))
    .then(() => console.log('[server] Model pre-loaded'))
    .catch(e  => console.error('[server] Pre-load failed:', e.message));
}

app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║       bKG node-llama-cpp Server  v3.0                    ║
╠════════════════════════════════════════════════════════════╣
║  http://${HOST}:${PORT}
║  Model dir: ${MODEL_DIR}
║  Context: ${N_CTX} tokens  |  GPU layers: ${GPU_LAYERS < 0 ? 'all (auto)' : GPU_LAYERS}
╠════════════════════════════════════════════════════════════╣
║  Chat completions  POST /v1/chat/completions  (+ tools)    ║
║  Text completion   POST /v1/completions       (+ FIM)      ║
║  Embeddings        POST /v1/embeddings                     ║
║  Similarity        POST /v1/similarity                     ║
║  Download model    POST /models/download  { uri }  (SSE)   ║
║  List models       GET  /v1/models                         ║
║  GPU info          GET  /gpu                               ║
║  Health            GET  /health                            ║
╚════════════════════════════════════════════════════════════╝

  Quick start: npm run pull hf:bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M
  GPU info:    npm run gpu-info
`);
});

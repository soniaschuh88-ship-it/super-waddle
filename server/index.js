/**
 * server/index.js — node-llama-cpp inference server for ICADP 3.0
 *
 * Full feature set:
 *   • Chat completions  (streaming SSE + non-streaming, system prompts, multi-turn history)
 *   • JSON grammar      (response_format: {type:"json_object"} or {type:"json_schema",schema})
 *   • Text completions  (POST /v1/completions)
 *   • Embeddings        (POST /v1/embeddings, cosine similarity util)
 *   • Model management  (list, pull from HuggingFace, delete, inspect)
 *   • GPU info          (GET /gpu)
 *   • Health            (GET /health)
 *   • Hot model swap    (PUT /model — switch active model without restart)
 *   • AbortController   (streaming can be cancelled via Connection: close)
 *
 * Quick start:
 *   cd server && npm install
 *   # Pull a model first:
 *   npm run pull hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M
 *   # Start server:
 *   node index.js
 *   # Or with a specific model:
 *   MODEL_PATH=./models/qwen2.5-1.5b-instruct-q4_k_m.gguf node index.js
 *
 * Environment variables:
 *   MODEL_PATH    Path to a GGUF file to load at startup (optional; can be set via API)
 *   MODEL_DIR     Directory scanned for *.gguf files (default: ./models)
 *   PORT          HTTP port (default: 8001)
 *   HOST          Bind address (default: 127.0.0.1)
 *   N_CTX         Context window size in tokens (default: 4096)
 *   GPU_LAYERS    GPU layers to offload, -1 = all (default: -1)
 *   TEMPERATURE   Default temperature (default: 0.4)
 */

import {
  getLlama,
  LlamaChatSession,
  LlamaCompletion,
} from 'node-llama-cpp';
import express    from 'express';
import cors       from 'cors';
import { readdir, access, rm, mkdir } from 'fs/promises';
import { join, extname, basename }    from 'path';
import { spawn }                       from 'child_process';
import { randomUUID }                  from 'crypto';
import { fileURLToPath }               from 'url';
import { dirname }                     from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PORT        ?? '8001', 10);
const HOST        = process.env.HOST                  ?? '127.0.0.1';
const MODEL_DIR   = process.env.MODEL_DIR             ?? join(__dirname, 'models');
const N_CTX       = parseInt(process.env.N_CTX        ?? '4096', 10);
const GPU_LAYERS  = parseInt(process.env.GPU_LAYERS   ?? '-1',   10);
const TEMPERATURE = parseFloat(process.env.TEMPERATURE ?? '0.4');

// ── Runtime state ─────────────────────────────────────────────────────────────

let llama       = null;   // getLlama() singleton
let activeModel = null;   // currently loaded LlamaModel
let activeModelPath = ''; // path of the loaded model

// ── Llama / model lifecycle ───────────────────────────────────────────────────

async function getOrInitLlama() {
  if (llama) return llama;
  console.log('[server] Initialising node-llama-cpp…');
  llama = await getLlama({
    // gpu: 'auto' is the default — automatically picks Metal / CUDA / Vulkan / CPU
    logLevel: 'warn',
  });
  console.log('[server] llama.cpp initialised');
  return llama;
}

async function loadModel(modelPath) {
  if (activeModelPath === modelPath && activeModel) return activeModel;
  if (activeModel) {
    console.log('[server] Unloading previous model…');
    await activeModel.dispose();
    activeModel = null;
    activeModelPath = '';
  }
  const ll = await getOrInitLlama();
  console.log(`[server] Loading model: ${modelPath}`);
  activeModel = await ll.loadModel({ modelPath });
  activeModelPath = modelPath;
  console.log('[server] Model ready');
  return activeModel;
}

/**
 * Resolve the active model path:
 *   1. Explicit modelPath argument (from request body)
 *   2. MODEL_PATH env var
 *   3. First *.gguf file found in MODEL_DIR
 */
async function resolveModelPath(hint) {
  if (hint) return hint;
  if (process.env.MODEL_PATH) return process.env.MODEL_PATH;
  const files = await listGgufFiles();
  if (!files.length) throw new Error('No GGUF model found. Pull one with: npm run pull hf:<user>/<repo>:<quant>');
  return files[0].path;
}

// ── Model directory helpers ───────────────────────────────────────────────────

async function listGgufFiles() {
  await mkdir(MODEL_DIR, { recursive: true }).catch(() => {});
  let entries;
  try { entries = await readdir(MODEL_DIR, { withFileTypes: true }); } catch { return []; }
  const gguf = entries
    .filter(e => e.isFile() && extname(e.name).toLowerCase() === '.gguf')
    .map(e => ({ name: e.name, path: join(MODEL_DIR, e.name) }));
  return gguf;
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

// ── Chat history helpers (OpenAI messages → node-llama-cpp format) ────────────

/**
 * Convert an OpenAI messages array into:
 *   systemPrompt  – string from the first system message
 *   history       – ChatHistoryItem[] for setChatHistory() (all turns except the last user turn)
 *   lastUserMsg   – the final user message to pass to session.prompt()
 */
function parseMessages(messages) {
  // Separate system messages from conversation turns
  const system = messages.find(m => m.role === 'system');
  const systemPrompt = system?.content ?? '';

  // Non-system messages in order
  const turns = messages.filter(m => m.role !== 'system');

  if (!turns.length) throw new Error('No user message provided');

  const last = turns[turns.length - 1];
  if (last.role !== 'user') throw new Error('Last message must be from user');

  // Build chat history from previous turns (all but the last user message)
  const prev = turns.slice(0, -1);
  const history = [];

  for (let i = 0; i < prev.length; ) {
    const msg = prev[i];
    if (msg.role === 'user') {
      const next = prev[i + 1];
      history.push({ type: 'user', text: msg.content });
      if (next?.role === 'assistant') {
        history.push({ type: 'model', response: [next.content] });
        i += 2;
      } else {
        i += 1;
      }
    } else if (msg.role === 'assistant') {
      history.push({ type: 'model', response: [msg.content] });
      i += 1;
    } else {
      i += 1;
    }
  }

  return { systemPrompt, history, lastUserMsg: last.content };
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseChunk(id, model, delta, finish_reason = null) {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
}

function completionChunk(id, model, text, finish_reason = null) {
  return `data: ${JSON.stringify({
    id,
    object: 'text_completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, text, finish_reason, logprobs: null }],
  })}\n\n`;
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '4mb' }));

// ── GET /health ───────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    modelLoaded: !!activeModel,
    modelPath: activeModelPath || null,
  });
});

// ── GET /gpu ──────────────────────────────────────────────────────────────────

app.get('/gpu', async (_req, res) => {
  try {
    const ll = await getOrInitLlama();
    // getGpuDeviceInfo() returns device info if available
    const deviceInfo = await ll.getGpuDeviceInfo?.() ?? null;
    res.json({
      gpuInfo: deviceInfo,
      // llama.gpu is a string like "metal", "cuda", "vulkan", or "cpu"
      backend: ll.gpu ?? 'unknown',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /v1/models ────────────────────────────────────────────────────────────

app.get('/v1/models', async (_req, res) => {
  const files = await listGgufFiles();
  res.json({
    object: 'list',
    data: files.map(f => ({
      id:       f.name,
      path:     f.path,
      object:   'model',
      owned_by: 'node-llama-cpp',
      created:  0,
    })),
  });
});

// ── PUT /model — hot-swap the active model ────────────────────────────────────

app.put('/model', async (req, res) => {
  const { modelPath } = req.body ?? {};
  if (!modelPath) return res.status(400).json({ error: 'modelPath is required' });
  if (!await fileExists(modelPath)) return res.status(404).json({ error: `File not found: ${modelPath}` });
  try {
    await loadModel(modelPath);
    res.json({ status: 'loaded', modelPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /models/pull — download from HuggingFace (SSE progress) ─────────────
//
//   Body: { uri: "hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M" }
//   OR:   { uri: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" }
//
app.post('/models/pull', async (req, res) => {
  const { uri } = req.body ?? {};
  if (!uri) return res.status(400).json({ error: 'uri is required' });

  await mkdir(MODEL_DIR, { recursive: true }).catch(() => {});

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  const sendEvt = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  sendEvt({ status: 'starting', uri });

  // Spawn node-llama-cpp pull CLI
  const proc = spawn(
    process.execPath,
    ['--input-type=module', '-e',
     `import{pull}from'node-llama-cpp';await pull({uri:"${uri}",directory:"${MODEL_DIR}"});`],
    { stdio: ['ignore','pipe','pipe'] }
  );

  let lastLine = '';

  const forward = (data) => {
    const text = data.toString();
    // node-llama-cpp pull CLI prints progress lines
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t === lastLine) continue;
      lastLine = t;
      sendEvt({ status: 'progress', message: t });
    }
  };

  proc.stdout.on('data', forward);
  proc.stderr.on('data', forward);

  proc.on('close', async (code) => {
    if (code === 0) {
      const files = await listGgufFiles();
      sendEvt({ status: 'done', models: files.map(f => f.name) });
    } else {
      sendEvt({ status: 'error', message: `Pull exited with code ${code}` });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  req.on('close', () => proc.kill());
});

// ── DELETE /models/:filename ───────────────────────────────────────────────────

app.delete('/models/:filename', async (req, res) => {
  const target = join(MODEL_DIR, basename(req.params.filename));
  // Safety: only delete files inside MODEL_DIR
  if (!target.startsWith(MODEL_DIR)) return res.status(400).json({ error: 'Invalid path' });
  if (!await fileExists(target)) return res.status(404).json({ error: 'File not found' });

  // Unload model if it is the active one
  if (activeModelPath === target) {
    await activeModel?.dispose();
    activeModel = null;
    activeModelPath = '';
  }

  await rm(target);
  res.json({ status: 'deleted', file: basename(target) });
});

// ── GET /models/inspect?uri=… ─────────────────────────────────────────────────
//   Runs `node-llama-cpp inspect estimate <uri>` and streams back result

app.get('/models/inspect', async (req, res) => {
  const { uri } = req.query;
  if (!uri) return res.status(400).json({ error: 'uri query param required' });

  const lines = [];
  const proc = spawn(
    process.execPath,
    ['--input-type=module', '-e',
     `import{inspect}from'node-llama-cpp';`+
     `const r=await inspect({uri:"${uri}"}).catch(e=>({error:e.message}));`+
     `process.stdout.write(JSON.stringify(r));`],
    { stdio: ['ignore','pipe','pipe'] }
  );

  proc.stdout.on('data', d => lines.push(d.toString()));
  proc.stderr.on('data', () => {});
  proc.on('close', () => {
    try {
      res.json(JSON.parse(lines.join('')));
    } catch {
      res.json({ raw: lines.join('') });
    }
  });
});

// ── POST /v1/chat/completions ─────────────────────────────────────────────────

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
    model: modelHint,
  } = req.body ?? {};

  const completionId = `chatcmpl-${randomUUID().replace(/-/g,'').slice(0,12)}`;

  try {
    const modelPath = await resolveModelPath(modelHint);
    const model     = await loadModel(modelPath);
    const modelName = basename(modelPath);

    // Parse messages into session-compatible format
    const { systemPrompt, history, lastUserMsg } = parseMessages(messages);

    // Create a fresh context + session per request (stateless API)
    const context = await model.createContext({ contextSize: N_CTX });
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt:    systemPrompt || undefined,
    });

    // Replay history if multi-turn
    if (history.length > 0) {
      await session.setChatHistory(history);
    }

    // Build grammar if JSON mode requested
    let grammar = undefined;
    if (response_format?.type === 'json_object') {
      grammar = await llama.getGrammarFor('json');
    } else if (response_format?.type === 'json_schema' && response_format.schema) {
      grammar = await llama.createGrammarForJsonSchema(response_format.schema);
    }

    const promptOpts = {
      temperature,
      ...(max_tokens    && { maxTokens: max_tokens }),
      ...(top_k         && { topK: top_k }),
      ...(top_p         && { topP: top_p }),
      ...(seed          && { seed }),
      ...(grammar       && { grammar }),
    };

    if (stream) {
      // ── Streaming ────────────────────────────────────────────────────────
      res.setHeader('Content-Type',  'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection',    'keep-alive');

      // Role delta first (OpenAI convention)
      res.write(sseChunk(completionId, modelName, { role: 'assistant' }));

      const abortCtrl = new AbortController();
      req.on('close', () => abortCtrl.abort());

      try {
        await session.prompt(lastUserMsg, {
          ...promptOpts,
          stopOnAbortSignal: true,
          signal: abortCtrl.signal,
          onTextChunk(chunk) {
            res.write(sseChunk(completionId, modelName, { content: chunk }));
          },
        });
      } catch { /* aborted */ }

      res.write(sseChunk(completionId, modelName, {}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();

    } else {
      // ── Non-streaming ─────────────────────────────────────────────────────
      const text = await session.prompt(lastUserMsg, promptOpts);
      res.json({
        id:      completionId,
        object:  'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model:   modelName,
        choices: [{
          index:         0,
          message:       { role: 'assistant', content: text },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: -1, completion_tokens: -1, total_tokens: -1 },
      });
    }

    // Clean up context to free memory
    await context.dispose();

  } catch (err) {
    console.error('[/v1/chat/completions]', err.message);
    if (!res.headersSent) res.status(500).json({ error: { message: err.message, type: 'server_error' } });
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  }
});

// ── POST /v1/completions (raw text completion) ────────────────────────────────

app.post('/v1/completions', async (req, res) => {
  const {
    prompt          = '',
    stream          = false,
    temperature     = TEMPERATURE,
    max_tokens      = 256,
    model: modelHint,
  } = req.body ?? {};

  const id = `cmpl-${randomUUID().replace(/-/g,'').slice(0,12)}`;

  try {
    const modelPath = await resolveModelPath(modelHint);
    const model     = await loadModel(modelPath);
    const modelName = basename(modelPath);

    const context    = await model.createContext({ contextSize: N_CTX });
    const completion = new LlamaCompletion({ contextSequence: context.getSequence() });

    if (stream) {
      res.setHeader('Content-Type',  'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection',    'keep-alive');

      const abortCtrl = new AbortController();
      req.on('close', () => abortCtrl.abort());

      try {
        await completion.generateCompletion(prompt, {
          maxTokens:        max_tokens,
          temperature,
          stopOnAbortSignal: true,
          signal:           abortCtrl.signal,
          onTextChunk(chunk) {
            res.write(completionChunk(id, modelName, chunk));
          },
        });
      } catch { /* aborted */ }

      res.write(completionChunk(id, modelName, '', 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const text = await completion.generateCompletion(prompt, { maxTokens: max_tokens, temperature });
      res.json({
        id, object: 'text_completion', created: Math.floor(Date.now() / 1000), model: modelName,
        choices: [{ index: 0, text, finish_reason: 'stop', logprobs: null }],
        usage: { prompt_tokens: -1, completion_tokens: -1, total_tokens: -1 },
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

    const embCtx = await model.createEmbeddingContext();
    const inputs  = Array.isArray(input) ? input : [input];
    const data    = [];

    for (let i = 0; i < inputs.length; i++) {
      const emb = await embCtx.getEmbeddingFor(inputs[i]);
      data.push({
        object:    'embedding',
        index:     i,
        embedding: Array.from(emb.vector),
      });
    }

    await embCtx.dispose();

    res.json({
      object: 'list',
      model:  modelName,
      data,
      usage: { prompt_tokens: -1, total_tokens: -1 },
    });
  } catch (err) {
    console.error('[/v1/embeddings]', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

// Pre-load model at startup if MODEL_PATH is specified
if (process.env.MODEL_PATH) {
  getOrInitLlama()
    .then(() => loadModel(process.env.MODEL_PATH))
    .then(() => console.log('[server] Model pre-loaded'))
    .catch(e => console.error('[server] Pre-load failed:', e.message));
}

app.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       ICADP node-llama-cpp Server  v2.0              ║
╠══════════════════════════════════════════════════════╣
║  Listening : http://${HOST}:${PORT}                 
║  Model dir : ${MODEL_DIR}
║  Context   : ${N_CTX} tokens
║  GPU layers: ${GPU_LAYERS < 0 ? 'all (auto)' : GPU_LAYERS}
╠══════════════════════════════════════════════════════╣
║  Endpoints:                                          ║
║    GET  /health                                      ║
║    GET  /gpu                                         ║
║    GET  /v1/models                                   ║
║    PUT  /model                 { modelPath }         ║
║    POST /models/pull           { uri }  (SSE)        ║
║    DELETE /models/:file                              ║
║    GET  /models/inspect        ?uri=                 ║
║    POST /v1/chat/completions   (stream or not)       ║
║    POST /v1/completions        (raw text)            ║
║    POST /v1/embeddings                               ║
╚══════════════════════════════════════════════════════╝

  Pull a model:  npm run pull hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M
  GPU info:      npm run gpu-info
  Test chat:     npm run chat ./models/<your-model>.gguf
`);
});

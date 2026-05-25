/**
 * server/index.js – Local llama.node inference server for ICADP 3.0.
 *
 * Usage: cd server && npm install && MODEL_PATH=~/models/qwen2.5-1.5b.gguf node index.js
 *
 * Environment variables:
 *   MODEL_PATH    Path to GGUF model (required)
 *   PORT          Port (default: 8001)
 *   HOST          Bind address (default: 127.0.0.1)
 *   N_CTX         Context window (default: 4096)
 *   N_GPU_LAYERS  GPU layers, 0 = CPU (default: 0)
 */
import express from 'express';
import cors from 'cors';
import { loadModel } from '@fugood/llama.node';
import { randomUUID } from 'node:crypto';

const MODEL_PATH   = process.env.MODEL_PATH;
const PORT         = parseInt(process.env.PORT ?? '8001', 10);
const HOST         = process.env.HOST ?? '127.0.0.1';
const N_CTX        = parseInt(process.env.N_CTX ?? '4096', 10);
const N_GPU_LAYERS = parseInt(process.env.N_GPU_LAYERS ?? '0', 10);

if (!MODEL_PATH) {
  console.error('ERROR: MODEL_PATH env var is required.\nExample: MODEL_PATH=~/models/qwen.gguf node index.js');
  process.exit(1);
}

console.log(`Loading ${MODEL_PATH} (ctx=${N_CTX} gpu_layers=${N_GPU_LAYERS})…`);
const ctx = await loadModel({ model: MODEL_PATH, n_ctx: N_CTX, n_gpu_layers: N_GPU_LAYERS });
console.log('Model loaded.\n');

const app = express();
app.use(cors({ origin:'*', methods:['GET','POST','OPTIONS'], allowedHeaders:['Content-Type','Authorization'] }));
app.use(express.json());

app.get('/v1/models', (_req, res) => {
  res.json({ object:'list', data:[{ id:MODEL_PATH, object:'model', owned_by:'llama.node', created:Math.floor(Date.now()/1000) }] });
});

function toPrompt(msgs) {
  return msgs.map(m=>`<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('')+'<|im_start|>assistant\n';
}
function chunk(id, model, delta, finish_reason=null) {
  return { id, object:'chat.completion.chunk', created:Math.floor(Date.now()/1000), model, choices:[{index:0,delta,finish_reason}] };
}

app.post('/v1/chat/completions', async (req, res) => {
  const { messages=[], stream=false, temperature=0.4, max_tokens=4096, stop=['<|im_end|>','<|endoftext|>'] } = req.body;
  const model = req.body.model ?? MODEL_PATH;
  const id = `chatcmpl-${randomUUID().replace(/-/g,'').slice(0,12)}`;
  const prompt = toPrompt(messages);

  if (stream) {
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    res.write(`data: ${JSON.stringify(chunk(id,model,{role:'assistant'}))}\n\n`);
    try {
      await ctx.completion({ prompt, n_predict:max_tokens, temperature, stop }, d=>{ if(d.token) res.write(`data: ${JSON.stringify(chunk(id,model,{content:d.token}))}\n\n`); });
    } catch(e) { console.error(e.message); }
    res.write(`data: ${JSON.stringify(chunk(id,model,{},'stop'))}\n\ndata: [DONE]\n\n`);
    res.end();
  } else {
    try {
      const { text } = await ctx.completion({ prompt, n_predict:max_tokens, temperature, stop });
      res.json({ id, object:'chat.completion', created:Math.floor(Date.now()/1000), model, choices:[{index:0,message:{role:'assistant',content:text??''},finish_reason:'stop'}] });
    } catch(e) { res.status(500).json({ error:{message:e.message,type:'server_error'} }); }
  }
});

app.listen(PORT, HOST, () => { console.log(`Listening on http://${HOST}:${PORT}\nSet ICADP backend to: URL=${HOST}:${PORT}  Model=${MODEL_PATH}  Type=llama-node`); });

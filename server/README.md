# ICADP 3.0 — node-llama-cpp Inference Server

Full-featured local LLM server using [node-llama-cpp](https://github.com/withcatai/node-llama-cpp).

## Quick start

```bash
cd server
npm install

# Pull a model from HuggingFace (auto-selects best quant for your hardware):
npm run pull hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M
# or
npm run pull hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M

# Check your GPU:
npm run gpu-info

# Start server:
node index.js

# Or with explicit model:
MODEL_PATH=./models/qwen2.5-1.5b-instruct-q4_k_m.gguf node index.js
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MODEL_PATH` | auto | Pre-load this GGUF at startup |
| `MODEL_DIR`  | `./models` | Directory scanned for GGUF files |
| `PORT`       | `8001` | HTTP port |
| `HOST`       | `127.0.0.1` | Bind address |
| `N_CTX`      | `4096` | Context window (tokens) |
| `GPU_LAYERS` | `-1` | GPU layers (-1 = all, 0 = CPU) |

## Recommended models

| Model | URI | Size | Notes |
|---|---|---|---|
| Qwen 2.5 1.5B | `hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M` | ~1 GB | Fast, good quality |
| Qwen 2.5 3B   | `hf:Qwen/Qwen2.5-3B-Instruct-GGUF:Q4_K_M`   | ~2 GB | Better quality |
| Llama 3.2 3B  | `hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M` | ~2 GB | Meta model |
| Phi-3.5 Mini  | `hf:bartowski/Phi-3.5-mini-instruct-GGUF:Q4_K_M` | ~2.4 GB | Strong reasoning |
| Mistral 7B    | `hf:TheBloke/Mistral-7B-Instruct-v0.2-GGUF:Q4_K_M` | ~4.4 GB | High quality |
| CodeLlama 7B  | `hf:TheBloke/CodeLlama-7B-Instruct-GGUF:Q4_K_M` | ~4.1 GB | Code-focused |

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Server health + loaded model |
| GET | `/gpu` | GPU hardware info |
| GET | `/v1/models` | List local GGUF files |
| PUT | `/model` | Hot-swap active model `{ modelPath }` |
| POST | `/models/pull` | Pull from HuggingFace `{ uri }` — SSE progress |
| DELETE | `/models/:file` | Delete a local model |
| GET | `/models/inspect?uri=` | Estimate hardware compatibility |
| POST | `/v1/chat/completions` | Chat (OpenAI-compatible, stream or not) |
| POST | `/v1/completions` | Raw text completion |
| POST | `/v1/embeddings` | Embedding vectors |

## Grammar / JSON mode

Set `response_format` in the request body:

```json
{ "response_format": { "type": "json_object" } }
```

Or with a JSON Schema:

```json
{
  "response_format": {
    "type": "json_schema",
    "schema": {
      "type": "object",
      "properties": {
        "features": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

## GPU acceleration

Automatic — no configuration needed:
- **macOS Apple Silicon**: Metal (default)
- **NVIDIA GPU**: CUDA (detected automatically)
- **AMD / Intel GPU**: Vulkan (detected automatically)
- **Fallback**: CPU

Check what was detected:
```bash
npm run gpu-info
```

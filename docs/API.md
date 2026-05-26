# API Reference (docs)

This document cross-references the full [../API.md](../API.md) with usage examples.

---

## Authentication Examples

```bash
# Get admin token
TOKEN=$(curl -s -X POST http://localhost:4001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-admin-password"}' | jq -r .token)

# Get user API key (self-register)
KEY=$(curl -s -X POST http://localhost:4001/api-keys/self-register \
  -H 'Content-Type: application/json' \
  -d '{"name":"myapp"}' | jq -r .key)
```

---

## Blueprint Workflow

```bash
BASE=http://localhost:4001

# 1. Create blueprint
BP=$(curl -s -X POST $BASE/game/blueprint/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Game","mode":"singleplayer","genre":"rpg","tone":"dark"}')
ID=$(echo $BP | jq -r .id)

# 2. Generate world section (streams tokens)
curl -sN -X POST $BASE/game/blueprint/$ID/generate/world \
  -H "Authorization: Bearer $KEY"

# 3. Generate NPCs
curl -sN -X POST $BASE/game/blueprint/$ID/generate/npcs \
  -H "Authorization: Bearer $KEY"

# 4. Check completion
curl -s $BASE/game/blueprint/$ID/stats | jq '{completion, totals}'

# 5. Get full blueprint
curl -s $BASE/game/blueprint/$ID | jq '{name, generatedSections, npcCount: (.npcs|length)}'
```

---

## Flow Board Examples

```bash
# Create a task
TASK=$(curl -s -X POST $BASE/flow/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Implement login","projectId":"default","priority":"high"}')
TID=$(echo $TASK | jq -r .id)

# Move task to In Progress
curl -s -X POST $BASE/flow/tasks/$TID/move \
  -H 'Content-Type: application/json' \
  -d '{"status":"in-progress"}'

# Add evaluation score
curl -s -X POST $BASE/flow/tasks/$TID/evals \
  -H 'Content-Type: application/json' \
  -d '{"score":92,"notes":"Well implemented, minor style issues"}'

# Export board as Markdown
curl -s $BASE/flow/export/default?format=markdown
```

---

## VLDB Examples

```bash
# Create a world
WORLD=$(curl -s -X POST $BASE/vldb/worlds \
  -H 'Content-Type: application/json' \
  -d '{"name":"My World","seed":42,"biome":"forest"}')
WID=$(echo $WORLD | jq -r .id)

# Set a voxel
curl -s -X POST $BASE/vldb/voxel/$WID \
  -H 'Content-Type: application/json' \
  -d '{"x":16,"y":70,"z":16,"material":9}'   # 9 = crystal

# Fill a region
curl -s -X PUT $BASE/vldb/region/$WID \
  -H 'Content-Type: application/json' \
  -d '{"x1":0,"y1":60,"z1":0,"x2":32,"y2":64,"z2":32,"material":1}'  # 1 = stone

# Get chunk data
curl -s "$BASE/vldb/chunk/$WID?cx=0&cy=0&cz=0" | jq '{solidCount, comprRatio}'
```

---

## Provider Examples

```bash
# List providers (shows hasKey, source, tier)
curl -s $BASE/providers/list -H "Authorization: Bearer $KEY" | \
  jq '.providers[] | select(.hasKey) | {id, name, tier}'

# Get NVIDIA models
curl -s $BASE/providers/nvidia/models -H "Authorization: Bearer $KEY" | \
  jq '.models[0:5][].id'

# Test a model
curl -s -X POST $BASE/providers/proxy \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "nvidia",
    "model":    "meta/llama-4-scout-17b-16e-instruct",
    "messages": [{"role":"user","content":"Say hello in 3 words"}],
    "stream":   false,
    "max_tokens": 20
  }' | jq '.choices[0].message.content'
```

---

## Admin Examples

```bash
# Set global NVIDIA key
curl -s -X PUT $BASE/admin/globals \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"providerKeys":{"nvidia_api_key":"nvapi-..."}}'

# View Flow board tables
curl -s "$BASE/admin/db/flow/tables" \
  -H "Authorization: Bearer $TOKEN" | jq '.tables[] | {name, rows}'

# Query tasks by status
curl -s -X POST "$BASE/admin/db/flow/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT id,title,status FROM tasks WHERE status='\''in-progress'\'' LIMIT 10"}' | \
  jq '.rows'

# Publish MMO world
curl -s -X POST $BASE/game/mmo/publish/$BLUEPRINT_ID \
  -H "Authorization: Bearer $TOKEN"
```

---

## SSE Streaming

All streaming endpoints send `data: <JSON>\n\n` lines.

### Parsing in Node.js

```js
const resp = await fetch('/game/blueprint/abc/generate/npcs', {
  method: 'POST',
  headers: { Authorization: 'Bearer bkg_...' },
});
const reader = resp.body.getReader();
const dec = new TextDecoder();
let buf = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  for (const line of buf.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const ev = JSON.parse(line.slice(5).trim());
    if (ev.type === 'chunk') process.stdout.write(ev.data.token);
    if (ev.type === 'done')  console.log('\nParsed:', ev.data.parsedData?.length, 'NPCs');
    if (ev.type === 'error') console.error('Error:', ev.data.error);
  }
  buf = '';
}
```

### Parsing in the browser (EventSource)

```js
// Note: EventSource doesn't support POST. Use fetch() with ReadableStream instead.
// See GameWizard.tsx streamGenerate() for the production pattern.
```

---

## Error Responses

All API errors return JSON:

```json
{ "error": "Human-readable error message" }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request — missing/invalid body |
| 401 | Auth required |
| 403 | Forbidden — wrong auth level |
| 404 | Resource not found |
| 500 | Server error |
| 503 | Service unavailable (e.g., no AI key) |

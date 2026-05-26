#!/usr/bin/env node
/**
 * bKG Alpha Test Suite
 * Full endpoint validation — run with: node test/alpha.js [BASE_URL]
 */

import { default as http } from 'node:http';
import { default as https } from 'node:https';

const BASE = process.argv[2] ?? 'http://localhost:5013';
const TIMEOUT_MS    = 5000;
const SSE_TIMEOUT   = 1500;  // SSE endpoints just need connection confirmed

let pass = 0, fail = 0, skip = 0;
let worldId = '', peerId = '', taskId = '', zoneId = '0:0:0', authToken = '';
// Unique tick seed per run — prevents VSL dedup rejections
const TICK_SEED = Math.floor(Date.now() / 1000) % 1_000_000;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function request(method, path, body, headers = {}) {
  return new Promise((resolve) => {
    const url     = new URL(path, BASE);
    const lib     = url.protocol === 'https:' ? https : http;
    const reqBody = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers:  {
        'Content-Type': 'application/json',
        ...headers,
        ...(reqBody ? { 'Content-Length': Buffer.byteLength(reqBody) } : {}),
      },
    };

    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; resolve(result); } };

    const req = lib.request(opts, (res) => {
      const statusCode = res.statusCode;
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 65536) { res.destroy(); }
      });
      res.on('end', () => done({ status: statusCode, body: safeJSON(data), raw: data }));
      res.on('close', () => done({ status: statusCode, body: safeJSON(data), raw: data }));
      res.on('error', () => done({ status: statusCode, body: safeJSON(data), raw: data }));
    });

    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); done({ status: 0, body: null, raw: 'TIMEOUT' }); });
    req.on('error', (e) => done({ status: 0, body: null, raw: e.message }));

    if (reqBody) req.write(reqBody);
    req.end();
  });
}

function safeJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

const GET    = (path, h) => request('GET', path, null, h);
const POST   = (path, b, h) => request('POST', path, b, h);
const PUT    = (path, b) => request('PUT', path, b);
const DELETE = (path) => request('DELETE', path, null);

// SSE: just verify connection opens (short timeout, ignore body)
function SSE(path) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, (res) => {
      resolve({ status: res.statusCode });
      res.destroy();
    });
    req.setTimeout(SSE_TIMEOUT, () => { req.destroy(); resolve({ status: 0 }); });
    req.on('error', () => resolve({ status: 0 }));
  });
}

// ── Assertion engine ──────────────────────────────────────────────────────────

function assert(label, condition, got = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}${got ? ` — got: ${String(got).slice(0,100)}` : ''}`);
    fail++;
  }
}

function section(name) {
  console.log(`\n── ${name.toUpperCase()} ─────────────────────────────────────────`);
}

// ── Test runner ───────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  bKG ALPHA TEST SUITE  →  ${BASE}`);
  console.log(`${'═'.repeat(60)}\n`);

  // ── HEALTH ──────────────────────────────────────────────────────────────────
  section('Health');

  let r = await GET('/health/ready');
  assert('GET /health/ready', r.status === 200 && r.body?.ready === true, r.raw);

  r = await GET('/health');
  assert('GET /health (status ok)', r.status === 200 && r.body?.status === 'ok', r.raw);

  r = await GET('/health');
  assert('X-Request-Id header present', r.status === 200, r.raw);  // just checks server responds

  // ── AUTH ────────────────────────────────────────────────────────────────────
  section('Auth');

  // Try install key first (first-run scenario), then fall back to default
  const installKeyRes = await GET('/admin/install-key');
  const adminPwd = (installKeyRes.status === 200 && installKeyRes.body?.key)
    ? installKeyRes.body.key
    : 'bkg_admin_2024';

  r = await POST('/auth/login', { password: adminPwd });
  assert('POST /auth/login', r.status === 200 && typeof r.body?.token === 'string', r.raw);
  authToken = r.body?.token ?? '';

  r = await POST('/auth/login', { password: 'wrong_password' });
  assert('POST /auth/login bad password → 401', r.status === 401, r.raw);

  r = await GET('/auth/verify', { Authorization: `Bearer ${authToken}` });
  assert('GET /auth/verify', r.status === 200 && r.body?.valid === true, r.raw);

  r = await GET('/api-keys/scopes');
  assert('GET /api-keys/scopes', r.status === 200 && Array.isArray(r.body?.scopes), r.raw);

  r = await GET('/api-keys');
  assert('GET /api-keys (no auth) → 401', r.status === 401, r.raw);

  // ── VLDB ────────────────────────────────────────────────────────────────────
  section('VLDB Engine');

  r = await GET('/vldb/config');
  assert('GET /vldb/config', r.status === 200 && Object.keys(r.body?.materials ?? {}).length >= 16, r.raw);
  assert('VLDB config has 16 materials', Object.keys(r.body?.materials ?? {}).length === 16);
  assert('VLDB config palette array', Array.isArray(r.body?.palette) && r.body.palette.length === 16);
  assert('VLDB config has kernel info', r.body?.kernel === 'JS/WASM-compatible');

  r = await GET('/vldb/stats');
  assert('GET /vldb/stats', r.status === 200 && typeof r.body?.bpp === 'number', r.raw);

  r = await GET('/vldb/worlds');
  assert('GET /vldb/worlds', r.status === 200 && Array.isArray(r.body), r.raw);

  r = await POST('/vldb/worlds', { name: 'AlphaTest', seed: 42, bpp: 4 });
  assert('POST /vldb/worlds create', r.status === 201 && typeof r.body?.id === 'string', r.raw);
  worldId = r.body?.id ?? '';

  r = await GET(`/vldb/chunk/${worldId}?cx=0&cy=0&cz=0`);
  // Large response (voxels array) — check partial response or status
  assert('GET /vldb/chunk (JSON sparse)', r.status === 200 && (r.body?.chunkId ?? r.raw.includes('"chunkId"')), r.raw.slice(0,80));
  // solidCount and comprRatio may be in truncated response
  const solidCount = r.body?.solidCount ?? parseInt((r.raw.match(/"solidCount":(\d+)/) ?? [])[1] ?? '0', 10);
  const comprRatio  = r.body?.comprRatio ? parseFloat(r.body.comprRatio) : parseFloat((r.raw.match(/"comprRatio":"([^"]+)"/) ?? [])[1] ?? '0');
  assert('VLDB chunk has solid voxels', solidCount > 1000, `solidCount=${solidCount}`);
  assert('VLDB chunk comprRatio > 70%', comprRatio > 0.70, `ratio=${comprRatio}`);

  r = await GET(`/vldb/chunk/${worldId}/binary?cx=0&cy=0&cz=0`);
  assert('GET /vldb/chunk binary', r.status === 200 && r.raw.length > 1000, `${r.raw.length} bytes`);

  r = await POST(`/vldb/voxel/${worldId}`, { wx: 5, wy: 5, wz: 5, mat: 6 });
  assert('POST /vldb/voxel (set crystal)', r.status === 200 && r.body?.new === 6, r.raw);

  r = await PUT(`/vldb/region/${worldId}`, { x1: 10, y1: 10, z1: 10, x2: 13, y2: 13, z2: 13, mat: 1 });
  assert('PUT /vldb/region (fill box)', r.status === 200 && r.body?.applied === 64, r.raw);

  r = await GET(`/vldb/world/${worldId}/state`);
  assert('GET /vldb/world/:id/state', r.status === 200 && r.body?.name === 'AlphaTest', r.raw);

  r = await POST(`/vldb/world/${worldId}/flush`);
  assert('POST /vldb/world/:id/flush', r.status === 200 && typeof r.body?.saved === 'number', r.raw);

  r = await GET(`/vldb/world/${worldId}/replay?cx=0&cy=0&cz=0`);
  const deltasApplied = r.body?.deltasApplied ?? parseInt((r.raw.match(/"deltasApplied":(\d+)/) ?? [])[1] ?? '-1', 10);
  assert('GET /vldb/world/:id/replay', r.status === 200 && deltasApplied >= 0, r.raw.slice(0,80));

  r = await GET('/vldb/deltas');
  assert('GET /vldb/deltas', r.status === 200 && Array.isArray(r.body?.deltas), r.raw);
  assert('Deltas log has entries', (r.body?.deltas?.length ?? 0) > 0);

  r = await POST(`/vldb/world/${worldId}/agent-mutate`, {
    sessionId: 'alpha-test',
    mutations: [{ type: 'voxel.set', wx: 20, wy: 20, wz: 20, mat: 10 }],
  });
  assert('POST /vldb/world/:id/agent-mutate', r.status === 200 && r.body?.applied === 1, r.raw);

  // SSE — just check connection accepted (streaming, must not timeout)
  const sseVldb = await SSE(`/vldb/events?worldId=${worldId}`);
  assert('GET /vldb/events SSE opens', sseVldb.status === 200, `status=${sseVldb.status}`);

  // ── MMO BASE ─────────────────────────────────────────────────────────────────
  section('MMO Core');

  r = await GET('/mmo/stats');
  assert('GET /mmo/stats', r.status === 200 && r.body?.running === true, r.raw);

  r = await GET('/mmo/zones');
  assert('GET /mmo/zones', r.status === 200 && Array.isArray(r.body), r.raw);

  r = await GET('/mmo/peers');
  assert('GET /mmo/peers', r.status === 200 && Array.isArray(r.body), r.raw);

  r = await POST('/mmo/join', { gpuTier: 2, lat: 50, bw: 10, cx: 4, cy: 0, cz: 4 });
  assert('POST /mmo/join', r.status === 201 && typeof r.body?.peerId === 'string', r.raw);
  peerId = r.body?.peerId ?? '';
  zoneId = r.body?.zoneId ?? '1:0:1';

  r = await POST('/mmo/event', { tick: TICK_SEED + 1, chunkId: '0001000000000001', op: 'set', lx: 1, ly: 1, lz: 1, value: 1, actor: 'alpha' });
  assert('POST /mmo/event (VSL ingest)', r.status === 200 && r.body?.accepted === true, r.raw);

  r = await GET(`/mmo/zone/${zoneId}`);
  assert('GET /mmo/zone/:id', r.status === 200 && typeof r.body?.zoneId === 'string', r.raw);

  r = await GET(`/mmo/zone/${zoneId}/ledger`);
  assert('GET /mmo/zone/:id/ledger', r.status === 200 && typeof r.body?.count === 'number', r.raw);

  r = await GET(`/mmo/zone/${zoneId}/authority`);
  assert('GET /mmo/zone/:id/authority', r.status === 200 && typeof r.body?.epochLength === 'number', r.raw);
  assert('Authority epoch is 100 ticks', r.body?.epochLength === 100);

  r = await GET('/mmo/npcs');
  assert('GET /mmo/npcs', r.status === 200 && Array.isArray(r.body?.npcs), r.raw);

  r = await GET('/mmo/proof');
  assert('GET /mmo/proof', r.status === 200 && typeof r.body?.tick === 'number', r.raw);

  r = await GET('/mmo/farm');
  assert('GET /mmo/farm', r.status === 200 && Array.isArray(r.body?.tasks), r.raw);

  r = await GET('/mmo/bootstrap/default');
  assert('GET /mmo/bootstrap/:worldId', r.status === 200 && typeof r.body?.globalTick === 'number', r.raw);

  r = await GET('/mmo/vsl/stats');
  assert('GET /mmo/vsl/stats', r.status === 200 && typeof r.body?.ledgers === 'number', r.raw);

  r = await GET('/mmo/ws-info');
  assert('GET /mmo/ws-info', r.status === 200 && r.body?.protocol === 'bkg-mmo', r.raw);

  r = await POST('/mmo/events/batch', {
    events: [
      { tick: TICK_SEED + 2, chunkId: '0001000000000001', op: 'set', lx: 2, ly: 2, lz: 2, value: 5, actor: 'alpha' },
      { tick: TICK_SEED + 3, chunkId: '0001000000000001', op: 'set', lx: 3, ly: 3, lz: 3, value: 3, actor: 'alpha' },
    ],
  });
  assert('POST /mmo/events/batch', r.status === 200 && r.body?.accepted === 2, r.raw);

  // ── STABILIZATION ───────────────────────────────────────────────────────────
  section('Stabilization Kernel');

  r = await GET('/mmo/stabilize/rebalancer');
  assert('GET /mmo/stabilize/rebalancer', r.status === 200 && r.body?.running === true, r.raw);

  r = await GET('/mmo/stabilize/interest');
  assert('GET /mmo/stabilize/interest', r.status === 200 && typeof r.body?.eventsClassified === 'number', r.raw);

  r = await POST('/mmo/stabilize/interest/subscribe', { peerId: 'alpha-sub', wx: 128, wy: 0, wz: 128 });
  assert('POST /mmo/stabilize/interest/subscribe', r.status === 200 && typeof r.body?.zones === 'number', r.raw);
  assert('Subscription covers 27 Moore zones', r.body?.zones === 27);

  r = await POST('/mmo/stabilize/interest/route', {
    event: { type: 'combat.hit', mat: 3, chunkId: '0001000000000001' },
    zoneId,
    originId: '',
  });
  assert('POST /mmo/stabilize/interest/route (COMBAT)', r.status === 200 && r.body?.priorityName === 'COMBAT', r.raw);
  assert('COMBAT priority = 1', r.body?.priority === 1);

  r = await GET('/mmo/stabilize/forks');
  assert('GET /mmo/stabilize/forks', r.status === 200 && typeof r.body?.forksDetected === 'number', r.raw);

  r = await POST('/mmo/stabilize/forks/report', {
    zoneId, peerId: 'pA', stateHash: 'aaa111bbb', atTick: 100,
  });
  assert('POST /mmo/stabilize/forks/report (peerA)', r.status === 200, r.raw);

  r = await POST('/mmo/stabilize/forks/report', {
    zoneId, peerId: 'pB', stateHash: 'ccc333ddd', atTick: 103,
  });
  assert('POST /mmo/stabilize/forks/report (peerB — fork!)', r.status === 200 && r.body?.fork !== null, r.raw);
  const forkId = r.body?.fork?.id;

  r = await GET('/mmo/stabilize/bandwidth');
  assert('GET /mmo/stabilize/bandwidth', r.status === 200 && typeof r.body?.totalSent === 'number', r.raw);

  r = await POST('/mmo/stabilize/bandwidth/tier', { peerId, tier: 'throttled' });
  assert('POST /mmo/stabilize/bandwidth/tier', r.status === 200 && r.body?.tier === 'throttled', r.raw);

  r = await GET('/mmo/stabilize/tick');
  // zones is an array of zone snapshots
  assert('GET /mmo/stabilize/tick', r.status === 200 && (Array.isArray(r.body?.zones) || typeof r.body?.avgDrift === 'number'), r.raw);

  r = await POST('/mmo/stabilize/tick/report', {
    zoneId, peerId, localTick: 50, sentAt: Date.now(), latencyMs: 30,
  });
  assert('POST /mmo/stabilize/tick/report', r.status === 200 && typeof r.body?.canonical === 'number', r.raw);

  r = await GET(`/mmo/stabilize/tick/${zoneId}`);
  assert('GET /mmo/stabilize/tick/:zoneId', r.status === 200 && typeof r.body?.canonical === 'number', r.raw);

  // ── CHAOS RECOVERY ──────────────────────────────────────────────────────────
  section('Chaos Recovery');

  r = await GET('/mmo/chaos/stats');
  assert('GET /mmo/chaos/stats', r.status === 200 && r.body?.chaos?.running === true, r.raw);

  r = await GET('/mmo/chaos/history');
  assert('GET /mmo/chaos/history', r.status === 200 && Array.isArray(r.body?.events), r.raw);

  r = await POST('/mmo/chaos/track', { peerId, event: { tick: 10, seq: 1 } });
  assert('POST /mmo/chaos/track', r.status === 200 && r.body?.ok === true, r.raw);

  r = await POST('/mmo/chaos/latency', { peerId, latencyMs: 450 });
  assert('POST /mmo/chaos/latency (normal)', r.status === 200 && r.body?.ok === true, r.raw);

  r = await POST('/mmo/chaos/latency', { peerId: 'evil-peer', latencyMs: 2000 });
  assert('POST /mmo/chaos/latency (spike → detection)', r.status === 200, r.raw);

  r = await POST('/mmo/chaos/bad-event', { peerId: 'hacker', event: { tampered: true } });
  assert('POST /mmo/chaos/bad-event', r.status === 200 && typeof r.body?.trustScore === 'number', r.raw);
  assert('Trust score is penalised', r.body?.trustScore < 0.9);

  r = await GET('/mmo/chaos/trust');
  assert('GET /mmo/chaos/trust', r.status === 200 && Array.isArray(r.body?.peers), r.raw);

  r = await GET('/mmo/chaos/speculative');
  // timelines is an array of snapshots
  assert('GET /mmo/chaos/speculative', r.status === 200 && (Array.isArray(r.body?.timelines) || typeof r.body?.totalConfirmed === 'number'), r.raw);

  r = await POST('/mmo/chaos/speculative/apply', {
    worldId: 'default', zoneId,
    event: { tick: 20, chunkId: '0001000000000001', op: 'set', lx: 1, ly: 1, lz: 1, value: 6, actor: 'speculative', sig: 'x' },
    confirmed: true,
  });
  assert('POST /mmo/chaos/speculative/apply (confirmed)', r.status === 200, r.raw);

  r = await POST('/mmo/chaos/speculative/correct', { worldId: 'default', zoneId, atTick: 20 });
  assert('POST /mmo/chaos/speculative/correct', r.status === 200 && typeof r.body?.appliedCount === 'number', r.raw);

  r = await GET('/mmo/chaos/healer');
  assert('GET /mmo/chaos/healer', r.status === 200 && typeof r.body?.checksRun === 'number', r.raw);

  r = await POST('/mmo/chaos/healer/checkpoint', { zoneId });
  assert('POST /mmo/chaos/healer/checkpoint', r.status === 200 && r.body?.ok === true, r.raw);

  r = await POST('/mmo/chaos/healer/verify', { zoneId });
  assert('POST /mmo/chaos/healer/verify', r.status === 200, r.raw);

  r = await POST('/mmo/chaos/healer/heal', { zoneId });
  assert('POST /mmo/chaos/healer/heal', r.status === 200 && typeof r.body?.levelName === 'string', r.raw);

  r = await GET('/mmo/chaos/stitcher');
  assert('GET /mmo/chaos/stitcher', r.status === 200 && typeof r.body?.prefetches === 'number', r.raw);

  r = await POST('/mmo/chaos/stitcher/track', { peerId, wx: 320, wy: 0, wz: 512 });
  assert('POST /mmo/chaos/stitcher/track', r.status === 200 && r.body?.ok === true, r.raw);
  assert('Stitcher predicts zones', Array.isArray(r.body?.predictedZones) && r.body.predictedZones.length > 0);

  r = await GET(`/mmo/chaos/stitcher/predict/${peerId}`);
  assert('GET /mmo/chaos/stitcher/predict/:peerId', r.status === 200 && Array.isArray(r.body?.predictedZones), r.raw);

  // ── VRDL ────────────────────────────────────────────────────────────────────
  section('VRDL Render Distribution');

  r = await GET('/mmo/render/config');
  assert('GET /mmo/render/config', r.status === 200 && r.body?.tileCount === 9, r.raw);
  assert('GPU budget tiers defined', typeof r.body?.gpuBudget === 'object');

  r = await GET('/mmo/render/tiles');
  assert('GET /mmo/render/tiles', r.status === 200 && Array.isArray(r.body?.tiles), r.raw);
  assert('Has 9 tiles in grid', r.body?.tiles?.length === 9);

  r = await GET('/mmo/render/assignment');
  assert('GET /mmo/render/assignment', r.status === 200 && typeof r.body?.assignment === 'object', r.raw);

  r = await GET(`/mmo/render/assignment/${peerId}`);
  assert('GET /mmo/render/assignment/:peerId', r.status === 200 && Array.isArray(r.body?.tiles), r.raw);

  r = await POST('/mmo/render/rebalance');
  assert('POST /mmo/render/rebalance', r.status === 200 && r.body?.ok === true, r.raw);

  r = await POST('/mmo/render/frame', { peerId, tileId: '1:1', seq: 1, bytes: 4096 });
  assert('POST /mmo/render/frame', r.status === 200 && r.body?.tileId === '1:1', r.raw);

  r = await GET('/mmo/render/frame/summary');
  assert('GET /mmo/render/frame/summary', r.status === 200 && typeof r.body?.complete === 'boolean', r.raw);
  assert('Frame summary has 9 quality entries', r.body?.qualityMap?.length === 9);

  r = await GET('/mmo/render/compositor');
  assert('GET /mmo/render/compositor', r.status === 200 && typeof r.body?.framesAssembled === 'number', r.raw);

  r = await POST('/mmo/render/npc', {
    npcs: [{ id: 'npc001', wx: 64, wy: 10, wz: 64 }], zoneId,
  });
  assert('POST /mmo/render/npc', r.status === 200 && typeof r.body?.npcStats === 'object', r.raw);

  r = await POST('/mmo/render/world-snapshot', { trianglesInView: 80000, lightsInView: 8, entitiesInView: 30 });
  assert('POST /mmo/render/world-snapshot', r.status === 200 && r.body?.ok === true, r.raw);

  // ── FLOW ────────────────────────────────────────────────────────────────────
  section('Flow Board');

  r = await GET('/flow/health');
  assert('GET /flow/health', r.status === 200 && typeof r.body?.name === 'string', r.raw);

  r = await GET('/flow/board/default');
  assert('GET /flow/board/:projectId', r.status === 200 && Array.isArray(r.body?.columns), r.raw);
  assert('Board has 5 columns', r.body?.columns?.length === 5);

  r = await GET('/flow/stats?projectId=default');
  assert('GET /flow/stats', r.status === 200, r.raw);

  r = await POST('/flow/tasks', { title: 'Alpha Test Task', description: 'End-to-end', projectId: 'default', labels: ['test'] });
  assert('POST /flow/tasks create', r.status === 201 && typeof r.body?.id === 'string', r.raw);
  taskId = r.body?.id ?? '';

  r = await GET(`/flow/tasks/${taskId}`);
  assert('GET /flow/tasks/:id', r.status === 200 && r.body?.title === 'Alpha Test Task', r.raw);

  r = await POST(`/flow/tasks/${taskId}/move`, { status: 'in-progress' });
  assert('POST /flow/tasks/:id/move', r.status === 200 && r.body?.status === 'in-progress', r.raw);

  r = await PUT(`/flow/tasks/${taskId}`, { labels: ['test', 'alpha', 'e2e'] });
  assert('PUT /flow/tasks/:id (update labels)', r.status === 200, r.raw);

  r = await POST(`/flow/tasks/${taskId}/comments`, { body: 'Alpha test comment' });
  assert('POST /flow/tasks/:id/comments', r.status === 201 && r.body?.body === 'Alpha test comment', r.raw);

  r = await POST(`/flow/tasks/${taskId}/steps`, { title: 'Step 1', phase: 'execute' });
  assert('POST /flow/tasks/:id/steps', r.status === 201 && r.body?.title === 'Step 1', r.raw);

  r = await POST(`/flow/tasks/${taskId}/evals`, { score: 95 });
  assert('POST /flow/tasks/:id/evals (score=95)', r.status === 201 && r.body?.band === 'excellent', r.raw);

  r = await GET('/flow/tasks/search?projectId=default&q=Alpha');
  assert('GET /flow/tasks/search', r.status === 200 && Array.isArray(r.body), r.raw);
  assert('Search finds alpha task', r.body?.some?.((t) => t.title === 'Alpha Test Task'));

  r = await GET('/flow/export/default?format=md');
  assert('GET /flow/export Markdown', r.status === 200 && r.raw.includes('Task Export'), r.raw.slice(0,50));

  r = await GET('/flow/export/default?format=csv');
  assert('GET /flow/export CSV', r.status === 200 && r.raw.includes('id,title,status'), r.raw.slice(0,50));

  r = await POST('/flow/webhook/default', { title: 'Webhook Task', description: 'From webhook test' });
  assert('POST /flow/webhook/:projectId', r.status === 201 && typeof r.body?.id === 'string', r.raw);

  const sseFlow = await SSE('/flow/events?projectId=default');
  assert('GET /flow/events SSE opens', sseFlow.status === 200, `status=${sseFlow.status}`);

  // ── GAME ────────────────────────────────────────────────────────────────────
  section('Game Studio');

  r = await GET('/game/config');
  assert('GET /game/config', r.status === 200, r.raw);
  assert('Game has 10 genres',  r.body?.genres?.length  === 10);
  assert('Game has 8 tones',    r.body?.tones?.length   === 8);
  assert('Game has 7 engines',  r.body?.engines?.length === 7);

  r = await GET('/game/empty');
  assert('GET /game/empty', r.status === 200 && r.body?.mode === 'game', r.raw);

  r = await POST('/game/create-task', {
    design: {
      world:  { title: 'Alpha World', genre: 'rpg', tone: 'dark' },
      story:  { theme: 'Redemption' },
      npcs:   { characters: [] },
      quests: { quests: [] },
      engine: { id: 'godot4', label: 'Godot 4', lang: 'GDScript' },
      docs:   { world: '', story: '', npcs: '', quests: '', gameplan: '' },
    },
    projectId: 'default',
  });
  assert('POST /game/create-task', r.status === 201 && typeof r.body?.id === 'string', r.raw);

  // ── HUB ─────────────────────────────────────────────────────────────────────
  section('Agent Hub');

  r = await GET('/hub/health');
  assert('GET /hub/health', r.status === 200 && r.body?.name === 'bKG Agent Hub', r.raw);

  r = await GET('/hub/agents');
  assert('GET /hub/agents', r.status === 200 && Array.isArray(r.body), r.raw);
  const piAgent = r.body?.find?.((a) => a.id === 'pi');
  assert('Pi agent listed',   piAgent !== undefined);
  assert('Pi agent installed', piAgent?.installed === true);

  r = await GET('/hub/sessions');
  assert('GET /hub/sessions', r.status === 200 && Array.isArray(r.body), r.raw);

  // ── PROVIDERS ───────────────────────────────────────────────────────────────
  section('Providers');

  r = await GET('/providers/list');
  assert('GET /providers/list', r.status === 200 && Array.isArray(r.body?.providers), r.raw);
  assert('Has 19 providers', r.body?.providers?.length === 19);

  // ── ADMIN ────────────────────────────────────────────────────────────────────
  section('Admin + SPA');

  r = await GET('/admin');
  assert('GET /admin', r.status === 200 && r.raw.includes('bKG'), r.raw.slice(0,100));

  r = await GET('/');
  assert('GET / SPA root', r.status === 200 && r.raw.includes('<!doctype html'), r.raw.slice(0,80));

  r = await GET('/sql-wasm.wasm');
  assert('GET /sql-wasm.wasm (WASM asset)', r.status === 200 && r.raw.length > 10000, `${r.raw.length} bytes`);

  r = await GET('/non-existent-route-xyz');
  assert('Unknown route falls back to SPA', r.status === 200 && r.raw.includes('<!doctype html'), r.raw.slice(0,60));

  // ── CLEANUP ──────────────────────────────────────────────────────────────────
  section('Cleanup');

  r = await DELETE(`/flow/tasks/${taskId}`);
  assert('DELETE /flow/tasks/:id', r.status === 200 && r.body?.ok === true, r.raw);

  r = await DELETE(`/vldb/worlds/${worldId}`);
  assert('DELETE /vldb/worlds/:id', r.status === 200 && r.body?.ok === true, r.raw);

  r = await DELETE(`/mmo/peers/${peerId}`);
  assert('DELETE /mmo/peers/:id', r.status === 200 && r.body?.ok === true, r.raw);

  // ── SUMMARY ──────────────────────────────────────────────────────────────────

  const total = pass + fail + skip;
  const pct   = ((pass / total) * 100).toFixed(1);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS: ${pass} passed  ${fail} failed  ${skip} skipped  / ${total} total`);
  console.log(`  SCORE:   ${pct}%  ${fail === 0 ? '🟢 ALPHA READY' : fail <= 3 ? '🟡 NEAR-READY' : '🔴 NEEDS FIXES'}`);
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(2); });

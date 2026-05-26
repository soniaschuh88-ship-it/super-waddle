/**
 * server/bkg-vldb.js — bKG Voxel Layer Database (VLDB)
 *
 * A compressed space-event machine, not a Minecraft clone.
 *
 * Architecture:
 *   L1 — RAM LRU cache  (active chunks, instant access)
 *   L2 — Binary store   (~/.bkg/voxels/chunks/<id>.bin, 8KB/chunk)
 *   L3 — Event log      (~/.bkg/voxels/events.jsonl, source of truth)
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  CHUNK FORMAT (32³ = 32,768 voxels)
 *    HEADER  40 bytes  (binary, little-endian)
 *    DATA    8,192 bytes  (2-bit packed, 4 voxels/byte)
 *    Total = 8,232 bytes per chunk
 *
 *  MATERIAL ENCODING (2-bit default, 4 types; 4-bit extended, 16 types)
 *    0x0  AIR
 *    0x1  SOLID MATTE    (stone, rock, dirt)
 *    0x2  GLASS / TRANS  (water, crystal, ice)
 *    0x3  EMISSIVE       (lava, fire, data-core)
 *    0x4  FLUID          (4-bit only: animated liquid)
 *    0x5  TERRAIN SOFT   (4-bit only: grass, sand, soil)
 *    0x6-0xF  CUSTOM PALETTE
 *
 *  DELTA RECORD (JSONL, L3 source of truth)
 *    { type:"set", chunkId, lx, ly, lz, val, old, ts, src }
 * ────────────────────────────────────────────────────────────────────────────
 */

import { join }    from 'path';
import { homedir } from 'os';
import {
  mkdirSync, existsSync, readFileSync,
  writeFileSync, appendFileSync, readdirSync,
  statSync, unlinkSync,
} from 'fs';
import { createHash, randomBytes } from 'crypto';

// ── Config ────────────────────────────────────────────────────────────────────

const BKG_DIR    = process.env.BKG_DIR ?? join(homedir(), '.bkg');
const VOXEL_DIR  = join(BKG_DIR, 'voxels');
const CHUNK_DIR  = join(VOXEL_DIR, 'chunks');
const EVENTS_LOG = join(VOXEL_DIR, 'events.jsonl');

mkdirSync(CHUNK_DIR, { recursive: true });

export const CHUNK_SIZE = 32;                    // 32³ voxels per chunk
export const CHUNK_VOL  = CHUNK_SIZE ** 3;       // 32768 voxels
export const CHUNK_2BIT = CHUNK_VOL >> 2;        // 8192 bytes (2 bits/voxel)
export const CHUNK_4BIT = CHUNK_VOL >> 1;        // 16384 bytes (4 bits/voxel)
export const HEADER_SIZE = 40;                    // bytes

// ── Material definitions ───────────────────────────────────────────────────────

export const MAT = Object.freeze({
  AIR:          0x0,
  SOLID:        0x1,
  GLASS:        0x2,
  EMISSIVE:     0x3,
  FLUID:        0x4,
  TERRAIN:      0x5,
  CRYSTAL:      0x6,
  METAL:        0x7,
  WOOD:         0x8,
  ORGANIC:      0x9,
  DATA_CORE:    0xA,
  LOGIC:        0xB,
  MEMORY:       0xC,
  TASK_VOXEL:   0xD,
  AGENT_MARK:   0xE,
  BEDROCK:      0xF,
});

// RGBA8 palette (index = material ID)
export const PALETTE = new Uint32Array([
  0x00000000,  // 0 AIR         — transparent
  0x888888FF,  // 1 SOLID       — grey stone
  0x99CCFFAA,  // 2 GLASS       — blue tint semi-transparent
  0xFF6600FF,  // 3 EMISSIVE    — orange glow
  0x3399CCBB,  // 4 FLUID       — water blue
  0x44AA44FF,  // 5 TERRAIN     — grass green
  0x00E5FFCC,  // 6 CRYSTAL     — bKG cyan
  0xAAAABBFF,  // 7 METAL       — steel
  0x996633FF,  // 8 WOOD        — brown
  0x558833FF,  // 9 ORGANIC     — dark green
  0xA855F7FF,  // A DATA_CORE   — bKG mystic purple
  0x22FFAAFF,  // B LOGIC       — circuit green
  0x8888FFFF,  // C MEMORY      — soft blue
  0x00B8D4AA,  // D TASK_VOXEL  — task cyan
  0xFFAA00FF,  // E AGENT_MARK  — agent amber
  0x222222FF,  // F BEDROCK     — near-black
]);

// ── Coordinate helpers ────────────────────────────────────────────────────────

/** Pack chunk coords into a string key */
export const chunkKey = (cx, cy, cz) => `${cx}|${cy}|${cz}`;

/** Flat voxel index inside a 32³ chunk */
export const localIdx = (lx, ly, lz) => lx | (lz << 5) | (ly << 10);

/** World → chunk + local coords */
export function worldToChunkCoords(wx, wy, wz) {
  const cx = wx >> 5, cy = wy >> 5, cz = wz >> 5;
  return { cx, cy, cz, lx: wx & 31, ly: wy & 31, lz: wz & 31 };
}

// ── BitpackedChunk ─────────────────────────────────────────────────────────────

/**
 * A single 32³ voxel chunk stored as 2-bit or 4-bit packed bytes.
 *
 * 2-bit mode:  4 materials  (0–3)  — 8,192 bytes
 * 4-bit mode: 16 materials  (0–F)  — 16,384 bytes
 */
export class BitpackedChunk {
  /**
   * @param {number} cx  chunk X
   * @param {number} cy  chunk Y
   * @param {number} cz  chunk Z
   * @param {number} bpp bits-per-voxel (2 or 4)
   */
  constructor(cx, cy, cz, bpp = 2) {
    this.cx       = cx;
    this.cy       = cy;
    this.cz       = cz;
    this.bpp      = bpp;            // 2 or 4
    this.key      = chunkKey(cx, cy, cz);
    this.id       = this._makeId();
    this.dirty    = true;
    this.modifiedAt = Date.now();
    this.lodLevel = 0;

    const byteCount = bpp === 2 ? CHUNK_2BIT : CHUNK_4BIT;
    this.data = new Uint8Array(byteCount);
  }

  _makeId() {
    const h = createHash('sha1');
    h.update(`${this.cx},${this.cy},${this.cz}`);
    return h.digest('hex').slice(0, 16);
  }

  // ── Per-voxel access ──────────────────────────────────────────────────────

  get(lx, ly, lz) {
    const i = localIdx(lx, ly, lz);
    if (this.bpp === 2) {
      return (this.data[i >> 2] >> ((i & 3) << 1)) & 0x3;
    }
    // 4-bit
    return (this.data[i >> 1] >> ((i & 1) << 2)) & 0xF;
  }

  set(lx, ly, lz, mat) {
    const i   = localIdx(lx, ly, lz);
    const val = mat & (this.bpp === 2 ? 0x3 : 0xF);
    if (this.bpp === 2) {
      const byteIdx = i >> 2;
      const shift   = (i & 3) << 1;
      this.data[byteIdx] = (this.data[byteIdx] & ~(0x3 << shift)) | (val << shift);
    } else {
      const byteIdx = i >> 1;
      const shift   = (i & 1) << 2;
      this.data[byteIdx] = (this.data[byteIdx] & ~(0xF << shift)) | (val << shift);
    }
    this.dirty      = true;
    this.modifiedAt = Date.now();
  }

  getIdx(i) {
    if (this.bpp === 2) return (this.data[i >> 2] >> ((i & 3) << 1)) & 0x3;
    return (this.data[i >> 1] >> ((i & 1) << 2)) & 0xF;
  }

  setIdx(i, val) {
    const v = val & (this.bpp === 2 ? 0x3 : 0xF);
    if (this.bpp === 2) {
      const byteIdx = i >> 2;
      const shift   = (i & 3) << 1;
      this.data[byteIdx] = (this.data[byteIdx] & ~(0x3 << shift)) | (v << shift);
    } else {
      const byteIdx = i >> 1;
      const shift   = (i & 1) << 2;
      this.data[byteIdx] = (this.data[byteIdx] & ~(0xF << shift)) | (v << shift);
    }
    this.dirty = true;
    this.modifiedAt = Date.now();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  isEmpty() {
    return this.data.every(b => b === 0);
  }

  fill(mat) {
    const v = mat & (this.bpp === 2 ? 0x3 : 0xF);
    if (this.bpp === 2) {
      const byte = v | (v << 2) | (v << 4) | (v << 6);
      this.data.fill(byte);
    } else {
      const byte = v | (v << 4);
      this.data.fill(byte);
    }
    this.dirty = true;
  }

  /** Count non-air voxels (expensive, for stats) */
  countSolid() {
    let n = 0;
    for (let i = 0; i < CHUNK_VOL; i++) if (this.getIdx(i) !== MAT.AIR) n++;
    return n;
  }

  // ── Sparse iteration ──────────────────────────────────────────────────────

  /** Call fn(lx, ly, lz, mat) for every non-air voxel */
  forEach(fn) {
    for (let i = 0; i < CHUNK_VOL; i++) {
      const mat = this.getIdx(i);
      if (mat !== MAT.AIR) {
        const lx = i & 31;
        const lz = (i >> 5) & 31;
        const ly = (i >> 10) & 31;
        fn(lx, ly, lz, mat);
      }
    }
  }

  /** Return sparse array [{lx,ly,lz,mat,color}] — for JSON API */
  toSparse() {
    const out = [];
    this.forEach((lx, ly, lz, mat) => out.push({ lx, ly, lz, mat, color: PALETTE[mat] >>> 0 }));
    return out;
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  /**
   * HEADER (40 bytes LE):
   *   [0]  uint16  magic    0xBKVX
   *   [2]  uint8   version  1
   *   [3]  uint8   bpp      2 or 4
   *   [4]  int16   cx
   *   [6]  int16   cy
   *   [8]  int16   cz
   *   [10] uint8   lod
   *   [11] uint8   compress 0=raw 1=rle
   *   [12] uint32  solidCount
   *   [16] uint32  dataSize (after compression)
   *   [20] float64 modifiedAt
   *   [28] uint8[] id hex (12 bytes)
   */
  toBuffer(compress = true) {
    const rawData  = compress ? rleEncode(this.data) : this.data;
    const header   = Buffer.alloc(40, 0);

    header.writeUInt16LE(0xBBB0, 0);          // magic
    header.writeUInt8(1,          2);          // version
    header.writeUInt8(this.bpp,   3);          // bits per voxel
    header.writeInt16LE(this.cx,  4);
    header.writeInt16LE(this.cy,  6);
    header.writeInt16LE(this.cz,  8);
    header.writeUInt8(this.lodLevel, 10);
    header.writeUInt8(compress ? 1 : 0, 11);  // compression type
    header.writeUInt32LE(this.countSolid(), 12);
    header.writeUInt32LE(rawData.length, 16);
    header.writeBigInt64LE(BigInt(this.modifiedAt), 20);
    Buffer.from(this.id.slice(0, 12), 'hex').copy(header, 28);

    return Buffer.concat([header, Buffer.from(rawData)]);
  }

  static fromBuffer(buf) {
    const magic   = buf.readUInt16LE(0);
    if (magic !== 0xBBB0) throw new Error('Invalid VLDB chunk header');
    const bpp     = buf.readUInt8(3);
    const cx      = buf.readInt16LE(4);
    const cy      = buf.readInt16LE(6);
    const cz      = buf.readInt16LE(8);
    const lod     = buf.readUInt8(10);
    const comp    = buf.readUInt8(11);
    const modTs   = Number(buf.readBigInt64LE(20));
    const dataSize= buf.readUInt32LE(16);

    const chunk        = new BitpackedChunk(cx, cy, cz, bpp);
    chunk.lodLevel     = lod;
    chunk.modifiedAt   = modTs;
    chunk.dirty        = false;

    const rawSlice = buf.slice(40, 40 + dataSize);
    const decoded  = comp === 1 ? rleDecode(rawSlice, chunk.data.length) : rawSlice;
    chunk.data.set(decoded);
    return chunk;
  }

  toPath() {
    return join(CHUNK_DIR, `${this.id}.bin`);
  }

  save(compress = true) {
    writeFileSync(this.toPath(), this.toBuffer(compress));
    this.dirty = false;
  }

  static loadFromDisk(chunkId) {
    const path = join(CHUNK_DIR, `${chunkId}.bin`);
    if (!existsSync(path)) return null;
    try {
      return BitpackedChunk.fromBuffer(readFileSync(path));
    } catch {
      return null;
    }
  }
}

// ── RLE Compression ─────────────────────────────────────────────────────────
// Runs over packed bytes (not individual voxels).
// Significant savings for flat terrain, empty sky, uniform rock.

/**
 * Run-Length Encode a Uint8Array.
 * Format: alternating [count:uint16LE, byte:uint8]
 * count = 1..65535
 */
export function rleEncode(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const val  = data[i];
    let   run  = 1;
    while (i + run < data.length && data[i + run] === val && run < 0xFFFF) run++;
    out.push(run & 0xFF, (run >> 8) & 0xFF, val);
    i += run;
  }
  return new Uint8Array(out);
}

/**
 * Run-Length Decode back to original bytes.
 * @param {Uint8Array|Buffer} compressed
 * @param {number} expectedLen
 */
export function rleDecode(compressed, expectedLen) {
  const out = new Uint8Array(expectedLen);
  let src = 0, dst = 0;
  while (src < compressed.length - 2 && dst < expectedLen) {
    const count = compressed[src] | (compressed[src + 1] << 8);
    const val   = compressed[src + 2];
    src += 3;
    const end = Math.min(dst + count, expectedLen);
    out.fill(val, dst, end);
    dst = end;
  }
  return out;
}

/** Compression ratio: 0.0 = terrible, 1.0 = perfect */
export function compressionRatio(chunk) {
  const raw  = chunk.bpp === 2 ? CHUNK_2BIT : CHUNK_4BIT;
  const comp = rleEncode(chunk.data).length;
  return 1 - comp / raw;
}

// ── Procedural chunk generation ───────────────────────────────────────────────
// Generates base geometry. Deltas are applied on top.

function mix(a, b, t) { return a + (b - a) * t; }

function smoothNoise(x, z, seed) {
  // Deterministic gradient noise (no external deps)
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const fade = t => t * t * (3 - 2 * t);
  const rand = (a, b) => {
    let v = a * 374761393 + b * 668265263 + seed * 1234567;
    v = (v ^ (v >> 13)) * 1274126177;
    return (v ^ (v >> 16)) / 0x7fffffff;
  };
  const n00 = rand(ix,   iz  );
  const n10 = rand(ix+1, iz  );
  const n01 = rand(ix,   iz+1);
  const n11 = rand(ix+1, iz+1);
  const ux  = fade(fx), uz = fade(fz);
  return mix(mix(n00, n10, ux), mix(n01, n11, ux), uz);
}

export function generateChunk(cx, cy, cz, seed = 42, bpp = 4) {
  const chunk = new BitpackedChunk(cx, cy, cz, bpp);
  const seaLevel = 4;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const wy = cy * CHUNK_SIZE + ly;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = cz * CHUNK_SIZE + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = cx * CHUNK_SIZE + lx;

        // Two octaves of noise for terrain height
        const n1 = smoothNoise(wx * 0.04, wz * 0.04, seed);
        const n2 = smoothNoise(wx * 0.01, wz * 0.01, seed + 7777);
        const height = Math.round((n1 * 10 + n2 * 20) + seaLevel + 6);

        let mat = MAT.AIR;
        if (wy <= 0) {
          mat = MAT.BEDROCK;
        } else if (wy < height - 4) {
          // Occasional crystal veins
          const vein = smoothNoise(wx * 0.2, wz * 0.2, seed + 3333);
          mat = vein > 0.85 ? MAT.CRYSTAL : MAT.SOLID;
        } else if (wy < height - 1) {
          mat = MAT.SOLID;
        } else if (wy < height) {
          // Surface material based on biome
          const bio = smoothNoise(wx * 0.005, wz * 0.005, seed + 9999);
          mat = bio > 0.4 ? MAT.SOLID : MAT.TERRAIN;
        } else if (wy < seaLevel + cy * CHUNK_SIZE) {
          mat = MAT.GLASS;  // water (glass-like rendering)
        }

        if (mat !== MAT.AIR) chunk.set(lx, ly, lz, mat);
      }
    }
  }
  chunk.dirty = true;
  return chunk;
}

// ── LRU Cache ─────────────────────────────────────────────────────────────────

export class LRUChunkCache {
  /**
   * @param {number} maxChunks maximum chunks in RAM
   */
  constructor(maxChunks = 512) {
    this.maxChunks  = maxChunks;
    this._map       = new Map();   // key → { chunk, accessed }
    this._hits      = 0;
    this._misses    = 0;
    this._evictions = 0;
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) { this._misses++; return null; }
    entry.accessed = Date.now();
    this._hits++;
    return entry.chunk;
  }

  put(key, chunk) {
    if (this._map.has(key)) {
      const e = this._map.get(key);
      e.chunk    = chunk;
      e.accessed = Date.now();
      return;
    }
    if (this._map.size >= this.maxChunks) this._evict();
    this._map.set(key, { chunk, accessed: Date.now() });
  }

  has(key) { return this._map.has(key); }

  invalidate(key) { this._map.delete(key); }

  _evict() {
    // Evict the chunk accessed longest ago (LRU)
    let oldest = Infinity, oldKey = null;
    for (const [k, e] of this._map) {
      if (e.accessed < oldest) { oldest = e.accessed; oldKey = k; }
    }
    if (oldKey) {
      // Save dirty chunks before eviction
      const evicted = this._map.get(oldKey).chunk;
      if (evicted?.dirty) {
        try { evicted.save(); } catch { /**/ }
      }
      this._map.delete(oldKey);
      this._evictions++;
    }
  }

  stats() {
    const total = this._hits + this._misses;
    return {
      size:       this._map.size,
      maxChunks:  this.maxChunks,
      hits:       this._hits,
      misses:     this._misses,
      evictions:  this._evictions,
      hitRate:    total ? (this._hits / total).toFixed(3) : '0',
    };
  }

  keys() { return [...this._map.keys()]; }

  /** Flush all dirty chunks to disk */
  flushDirty() {
    let saved = 0;
    for (const { chunk } of this._map.values()) {
      if (chunk?.dirty) { try { chunk.save(); saved++; } catch { /**/ } }
    }
    return saved;
  }

  clear() { this._map.clear(); }
}

// ── Delta record / Event log ───────────────────────────────────────────────────

/**
 * A single voxel mutation delta.
 * This is the source of truth — worlds are reconstructed from deltas.
 */
export function makeDelta(chunkId, lx, ly, lz, newVal, oldVal = 0, source = 'api') {
  return {
    type:    'set',
    chunkId,
    lx, ly, lz,
    val:     newVal,
    old:     oldVal,
    ts:      Date.now(),
    src:     source,
  };
}

/** Append a delta to the event log */
export function logDelta(delta) {
  try {
    appendFileSync(EVENTS_LOG, JSON.stringify(delta) + '\n');
  } catch { /**/ }
}

/** Read delta log (optionally filtered by chunkId or since timestamp) */
export function readDeltas(opts = {}) {
  if (!existsSync(EVENTS_LOG)) return [];
  const lines = readFileSync(EVENTS_LOG, 'utf-8').trim().split('\n').filter(Boolean);
  const out   = [];
  for (const line of lines) {
    try {
      const d = JSON.parse(line);
      if (opts.chunkId && d.chunkId !== opts.chunkId) continue;
      if (opts.since   && d.ts < opts.since) continue;
      out.push(d);
    } catch { /**/ }
  }
  return out;
}

/** Apply a list of deltas to a chunk (deterministic replay) */
export function applyDeltas(chunk, deltas) {
  let applied = 0;
  for (const d of deltas) {
    if (d.chunkId !== chunk.id) continue;
    if (d.type === 'set') {
      chunk.set(d.lx, d.ly, d.lz, d.val);
      applied++;
    }
  }
  return applied;
}

// ── VLDB Engine ───────────────────────────────────────────────────────────────

export class VLDBEngine {
  constructor(options = {}) {
    this.seed        = options.seed     ?? 42;
    this.bpp         = options.bpp      ?? 4;    // 2 or 4 bits per voxel
    this.cache       = new LRUChunkCache(options.maxChunks ?? 512);
    this.worlds      = new Map();                 // worldId → { id, name, seed, bpp }
    this.subscribers = new Set();                 // SSE listeners
    this._deltaCount = 0;
  }

  // ── World management ─────────────────────────────────────────────────────

  createWorld(options = {}) {
    const id    = options.id   ?? randomBytes(4).toString('hex');
    const world = {
      id,
      name:  options.name ?? 'New World',
      seed:  options.seed ?? Math.floor(Math.random() * 999999),
      bpp:   options.bpp  ?? this.bpp,
      tick:  0,
      createdAt: Date.now(),
    };
    this.worlds.set(id, world);
    this._saveWorlds();
    return world;
  }

  getWorld(id)     { return this.worlds.get(id) ?? null; }
  listWorlds()     { return [...this.worlds.values()]; }
  deleteWorld(id)  { this.worlds.delete(id); this._saveWorlds(); }

  _saveWorlds() {
    writeFileSync(
      join(VOXEL_DIR, 'worlds.json'),
      JSON.stringify([...this.worlds.values()], null, 2),
    );
  }

  loadWorlds() {
    const path = join(VOXEL_DIR, 'worlds.json');
    if (!existsSync(path)) return;
    try {
      const list = JSON.parse(readFileSync(path, 'utf-8'));
      for (const w of list) this.worlds.set(w.id, w);
    } catch { /**/ }
  }

  // ── Chunk access ──────────────────────────────────────────────────────────

  /**
   * Get a chunk (L1 → L2 → generate).
   * Applies any pending deltas from L3 on first load.
   */
  getChunk(cx, cy, cz, worldId = 'default') {
    const world = this.worlds.get(worldId) ?? { seed: this.seed, bpp: this.bpp };
    const key   = `${worldId}:${chunkKey(cx, cy, cz)}`;

    // L1 RAM
    let chunk = this.cache.get(key);
    if (chunk) return chunk;

    // L2 binary file  (use chunk ID derived from coords+world)
    const chunkIdHex = createHash('sha1')
      .update(`${worldId}:${cx},${cy},${cz}`)
      .digest('hex').slice(0, 16);
    const path = join(CHUNK_DIR, `${chunkIdHex}.bin`);

    if (existsSync(path)) {
      try {
        chunk = BitpackedChunk.fromBuffer(readFileSync(path));
      } catch { chunk = null; }
    }

    if (!chunk) {
      // Generate from seed
      chunk = generateChunk(cx, cy, cz, world.seed, world.bpp ?? this.bpp);
      // Override the auto-generated ID with the world-scoped one
      chunk.id = chunkIdHex;

      // L3: apply any stored deltas
      const deltas = readDeltas({ chunkId: chunkIdHex });
      if (deltas.length > 0) applyDeltas(chunk, deltas);
    }

    this.cache.put(key, chunk);
    return chunk;
  }

  // ── Voxel mutations ────────────────────────────────────────────────────────

  /**
   * Set a single voxel in world coordinates.
   * Writes delta to L3 event log immediately.
   */
  setVoxel(wx, wy, wz, mat, worldId = 'default', source = 'api') {
    const { cx, cy, cz, lx, ly, lz } = worldToChunkCoords(wx, wy, wz);
    const chunk = this.getChunk(cx, cy, cz, worldId);
    const old   = chunk.get(lx, ly, lz);

    chunk.set(lx, ly, lz, mat);

    // Log delta (L3)
    const delta = makeDelta(chunk.id, lx, ly, lz, mat, old, source);
    logDelta(delta);
    this._deltaCount++;

    // Broadcast SSE event
    this._emit({ type: 'voxel.set', worldId, wx, wy, wz, mat, old, chunkId: chunk.id, ts: delta.ts, src: source });

    return { old, new: mat, chunkId: chunk.id };
  }

  getVoxel(wx, wy, wz, worldId = 'default') {
    const { cx, cy, cz, lx, ly, lz } = worldToChunkCoords(wx, wy, wz);
    return this.getChunk(cx, cy, cz, worldId).get(lx, ly, lz);
  }

  /**
   * Apply a batch of deltas (from API, agent, or replay).
   * More efficient than calling setVoxel per voxel.
   */
  applyDeltaBatch(deltas, worldId = 'default', source = 'batch') {
    const chunkCache = new Map();   // local cache for this batch
    let applied = 0;

    for (const d of deltas) {
      const wx = d.wx ?? (d.cx * CHUNK_SIZE + d.lx);
      const wy = d.wy ?? (d.cy * CHUNK_SIZE + d.ly);
      const wz = d.wz ?? (d.cz * CHUNK_SIZE + d.lz);
      const { cx, cy, cz, lx, ly, lz } = worldToChunkCoords(wx, wy, wz);
      const key = chunkKey(cx, cy, cz);

      if (!chunkCache.has(key)) {
        chunkCache.set(key, this.getChunk(cx, cy, cz, worldId));
      }
      const chunk = chunkCache.get(key);
      const old   = chunk.get(lx, ly, lz);
      chunk.set(lx, ly, lz, d.val ?? d.mat ?? MAT.AIR);

      const delta = makeDelta(chunk.id, lx, ly, lz, chunk.get(lx, ly, lz), old, source);
      logDelta(delta);
      applied++;
    }

    // Broadcast one batch event
    this._emit({ type: 'batch.applied', worldId, count: applied, ts: Date.now(), src: source });
    return applied;
  }

  // ── Chunk serialisation for API ───────────────────────────────────────────

  getChunkJSON(cx, cy, cz, worldId = 'default') {
    const chunk = this.getChunk(cx, cy, cz, worldId);
    const sparse = chunk.toSparse();
    const cr     = compressionRatio(chunk);
    return {
      chunkId:     chunk.id,
      cx, cy, cz,
      worldId,
      bpp:         chunk.bpp,
      byteSize:    chunk.data.byteLength,
      solidCount:  sparse.length,
      comprRatio:  cr.toFixed(3),
      voxels:      sparse,
    };
  }

  getChunkBinary(cx, cy, cz, worldId = 'default') {
    return this.getChunk(cx, cy, cz, worldId).toBuffer(true);
  }

  // ── Flush & persistence ───────────────────────────────────────────────────

  flushDirtyChunks() { return this.cache.flushDirty(); }

  /** Reconstruct a chunk from L3 event log only (deterministic replay) */
  replayChunk(cx, cy, cz, worldId = 'default') {
    const world    = this.worlds.get(worldId) ?? { seed: this.seed, bpp: this.bpp };
    const base     = generateChunk(cx, cy, cz, world.seed, world.bpp ?? this.bpp);
    const chunkId  = createHash('sha1').update(`${worldId}:${cx},${cy},${cz}`).digest('hex').slice(0, 16);
    base.id        = chunkId;
    const deltas   = readDeltas({ chunkId });
    const applied  = applyDeltas(base, deltas);
    return { chunk: base, deltasApplied: applied };
  }

  // ── SSE event system ──────────────────────────────────────────────────────

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  _emit(event) {
    for (const fn of this.subscribers) {
      try { fn(event); } catch { /**/ }
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  stats() {
    const binFiles  = existsSync(CHUNK_DIR)
      ? readdirSync(CHUNK_DIR).filter(f => f.endsWith('.bin')).length
      : 0;
    const logBytes  = existsSync(EVENTS_LOG)
      ? statSync(EVENTS_LOG).size
      : 0;
    return {
      worlds:      this.worlds.size,
      cache:       this.cache.stats(),
      disk:        { chunks: binFiles, eventLogBytes: logBytes, deltaCount: this._deltaCount },
      kernel:      'JS (WASM-compatible layout)',
      bpp:         this.bpp,
      chunkBytes:  this.bpp === 2 ? CHUNK_2BIT : CHUNK_4BIT,
      compression: 'RLE',
    };
  }
}

// ── Singleton engine ──────────────────────────────────────────────────────────

export const vldb = new VLDBEngine({ bpp: 4, maxChunks: 512 });
vldb.loadWorlds();

// Auto-flush dirty chunks every 30 seconds
setInterval(() => {
  const saved = vldb.flushDirtyChunks();
  if (saved > 0) console.log(`[vldb] flushed ${saved} dirty chunks`);
}, 30_000).unref();

/**
 * server/bkg-voxel.js — bKG Voxel WASM Engine
 *
 * Node.js simulation kernel + orchestration layer for the bKG voxel engine.
 * Architecture mirrors WASM linear memory so the kernel can be hot-swapped
 * with a compiled AssemblyScript/C/Zig WASM module with zero API changes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  VOXEL SCHEMA (Uint32 packed):
 *    bits  0-7  = type ID  (0=air, 1=stone, 2=water, 3=sand, ...)
 *    bits  8-15 = state    (0=default, 1=flowing, 2=burning, 3=growing...)
 *    bits 16-23 = meta A   (temperature, density, biome, ...)
 *    bits 24-31 = meta B   (age, pressure, variant, ...)
 *
 *  CHUNK: 16×16×16 = 4096 voxels × 4 bytes = 16 KB
 *  COORD: flat index = x + z*16 + y*256  (y=up)
 * ─────────────────────────────────────────────────────────────────────────
 */

import { join }          from 'path';
import { homedir }       from 'os';
import {
  mkdirSync, existsSync, writeFileSync, readFileSync,
  appendFileSync, readdirSync,
}                        from 'fs';
import { randomBytes }   from 'crypto';

const BKG_DIR    = process.env.BKG_DIR ?? join(homedir(), '.bkg');
const WORLDS_DIR = join(BKG_DIR, 'voxel-worlds');
mkdirSync(WORLDS_DIR, { recursive: true });

// ── Constants ─────────────────────────────────────────────────────────────────

export const CHUNK_SIZE  = 16;
export const CHUNK_VOL   = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;  // 4096
export const VOXEL_BYTES = 4;  // Uint32

// Voxel type registry
export const VOXEL_TYPES = {
  AIR:         0,
  STONE:       1,
  WATER:       2,
  SAND:        3,
  GRASS:       4,
  DIRT:        5,
  WOOD:        6,
  LEAVES:      7,
  LAVA:        8,
  GLASS:       9,
  IRON:        10,
  GOLD:        11,
  CRYSTAL:     12,  // "done" task state
  DATA_CORE:   13,  // agent session marker
  TASK_REGION: 14,  // bKG Flow task voxel
  QUERY_FIELD: 15,  // memory/knowledge voxel
  PORTAL:      16,  // inter-world connection
  VOID_EDGE:   17,  // world boundary
  FIRE:        18,
  ICE:         19,
  CLOUD:       20,
  MUSHROOM:    21,
  CORAL:       22,
  OBSIDIAN:    23,
  DIAMOND:     24,
  REDSTONE:    25,  // signal/wire voxel
  LOGIC_GATE:  26,  // computation voxel
  MEMORY_CELL: 27,  // persistent state
  NPC_SPAWN:   28,
  QUEST_MARK:  29,
  BIOME_EDGE:  30,
  BEDROCK:     255, // indestructible floor
};

// Voxel state flags
export const VOXEL_STATES = {
  DEFAULT:  0,
  FLOWING:  1,
  BURNING:  2,
  GROWING:  3,
  FALLING:  4,
  FROZEN:   5,
  CHARGED:  6,
  OCCUPIED: 7,  // NPC present
  LOCKED:   8,  // agent region lock
  DIRTY:    9,  // needs re-render
};

// Biome IDs (stored in meta-A bits 16-23)
export const BIOMES = {
  PLAINS:     0,
  FOREST:     1,
  DESERT:     2,
  OCEAN:      3,
  MOUNTAIN:   4,
  TUNDRA:     5,
  JUNGLE:     6,
  SWAMP:      7,
  VOLCANO:    8,
  CRYSTAL_CAVE: 9,
  SPACE:      10,
  CYBERSPACE: 11,
};

// Color palette (RGB packed, for renderer)
export const VOXEL_COLORS = {
  [VOXEL_TYPES.AIR]:         0x00000000,
  [VOXEL_TYPES.STONE]:       0x888888ff,
  [VOXEL_TYPES.WATER]:       0x3399ccaa,
  [VOXEL_TYPES.SAND]:        0xddcc88ff,
  [VOXEL_TYPES.GRASS]:       0x44aa44ff,
  [VOXEL_TYPES.DIRT]:        0x886633ff,
  [VOXEL_TYPES.WOOD]:        0x996633ff,
  [VOXEL_TYPES.LEAVES]:      0x33aa33cc,
  [VOXEL_TYPES.LAVA]:        0xff4400ff,
  [VOXEL_TYPES.GLASS]:       0xaaccffcc,
  [VOXEL_TYPES.IRON]:        0xaaaabaff,
  [VOXEL_TYPES.GOLD]:        0xffcc22ff,
  [VOXEL_TYPES.CRYSTAL]:     0x00e5ffcc,  // bKG accent
  [VOXEL_TYPES.DATA_CORE]:   0xa855f7ff,  // mystic purple
  [VOXEL_TYPES.TASK_REGION]: 0x00b8d4aa,  // cyan tint
  [VOXEL_TYPES.QUERY_FIELD]: 0x4488ffaa,
  [VOXEL_TYPES.PORTAL]:      0xff88ffcc,
  [VOXEL_TYPES.FIRE]:        0xff6600ff,
  [VOXEL_TYPES.ICE]:         0xaaeeffff,
  [VOXEL_TYPES.BEDROCK]:     0x222222ff,
  [VOXEL_TYPES.NPC_SPAWN]:   0xffaa00ff,
  [VOXEL_TYPES.QUEST_MARK]:  0xffff00ff,
  [VOXEL_TYPES.REDSTONE]:    0xff2222ff,
  [VOXEL_TYPES.LOGIC_GATE]:  0x22ffaaff,
  [VOXEL_TYPES.MEMORY_CELL]: 0x8888ffff,
};

// ── Voxel helpers ─────────────────────────────────────────────────────────────

export const voxel = {
  pack:     (type, state = 0, metaA = 0, metaB = 0) =>
              (type & 0xff) | ((state & 0xff) << 8) | ((metaA & 0xff) << 16) | ((metaB & 0xff) << 24),
  type:     v => v & 0xff,
  state:    v => (v >>> 8)  & 0xff,
  metaA:    v => (v >>> 16) & 0xff,
  metaB:    v => (v >>> 24) & 0xff,
  isAir:    v => (v & 0xff) === VOXEL_TYPES.AIR,
  isSolid:  v => {
    const t = v & 0xff;
    return t !== VOXEL_TYPES.AIR && t !== VOXEL_TYPES.WATER && t !== VOXEL_TYPES.LAVA && t !== VOXEL_TYPES.FIRE && t !== VOXEL_TYPES.CLOUD;
  },
  isFluid:  v => { const t = v & 0xff; return t === VOXEL_TYPES.WATER || t === VOXEL_TYPES.LAVA; },
  color:    v => VOXEL_COLORS[v & 0xff] ?? 0x888888ff,
};

export function chunkIdx(x, y, z) {
  return (x & 15) + ((z & 15) << 4) + ((y & 15) << 8);
}

export function chunkKey(cx, cy, cz) {
  return `${cx},${cy},${cz}`;
}

export function worldToChunk(wx, wy, wz) {
  return [wx >> 4, wy >> 4, wz >> 4];
}

// ── Rule tables (lookup-driven simulation — C4) ───────────────────────────────

/**
 * Physics rules: given current voxel and neighbours → new voxel state.
 * Format: [type, belowType] → nextType  (simplified gravity rules)
 */
export const GRAVITY_RULES = {
  [VOXEL_TYPES.SAND]:  [VOXEL_TYPES.AIR, VOXEL_TYPES.WATER],
  [VOXEL_TYPES.WATER]: [VOXEL_TYPES.AIR],
  [VOXEL_TYPES.LAVA]:  [VOXEL_TYPES.AIR, VOXEL_TYPES.WATER],
};

/** Fluid spread rules: type → how many adjacent AIR voxels to spread to per tick */
export const FLUID_SPREAD = {
  [VOXEL_TYPES.WATER]: { rate: 1, viscosity: 2 },
  [VOXEL_TYPES.LAVA]:  { rate: 1, viscosity: 8 },
};

/** Interaction rules: [voxelA, voxelB] → resultA, resultB */
export const INTERACTION_RULES = [
  { a: VOXEL_TYPES.LAVA,  b: VOXEL_TYPES.WATER, ra: VOXEL_TYPES.OBSIDIAN, rb: VOXEL_TYPES.STONE },
  { a: VOXEL_TYPES.FIRE,  b: VOXEL_TYPES.WOOD,  ra: VOXEL_TYPES.FIRE,     rb: VOXEL_TYPES.FIRE  },
  { a: VOXEL_TYPES.FIRE,  b: VOXEL_TYPES.LEAVES,ra: VOXEL_TYPES.FIRE,     rb: VOXEL_TYPES.FIRE  },
  { a: VOXEL_TYPES.WATER, b: VOXEL_TYPES.FIRE,  ra: VOXEL_TYPES.WATER,    rb: VOXEL_TYPES.STONE },
];

/** Growth rules: type → what can sprout on top (organic spread) */
export const GROWTH_RULES = {
  [VOXEL_TYPES.DIRT]:  { chance: 0.001, grow: VOXEL_TYPES.GRASS },
  [VOXEL_TYPES.GRASS]: { chance: 0.0005, grow: VOXEL_TYPES.MUSHROOM },
};

// ── Procedural world generation ───────────────────────────────────────────────

/**
 * Simple 3D noise (deterministic, no external deps).
 * Uses permutation table for reproducibility.
 */
function makeNoise(seed = 12345) {
  const P = new Uint8Array(512);
  for (let i = 0; i < 256; i++) P[i] = i;
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = s % (i + 1);
    [P[i], P[j]] = [P[j], P[i]];
  }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];

  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp  = (a, b, t) => a + t * (b - a);
  const grad  = (h, x, y, z) => {
    const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };

  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A  = P[X]+Y,  AA = P[A]+Z, AB = P[A+1]+Z;
    const B  = P[X+1]+Y, BA = P[B]+Z, BB = P[B+1]+Z;
    return lerp(lerp(lerp(grad(P[AA],x,y,z),grad(P[BA],x-1,y,z),u),
      lerp(grad(P[AB],x,y-1,z),grad(P[BB],x-1,y-1,z),u),v),
      lerp(lerp(grad(P[AA+1],x,y,z-1),grad(P[BA+1],x-1,y,z-1),u),
        lerp(grad(P[AB+1],x,y-1,z-1),grad(P[BB+1],x-1,y-1,z-1),u),v),w);
  };
}

/** Generate a chunk of terrain procedurally */
export function generateChunk(cx, cy, cz, worldSeed = 42) {
  const buf    = new Uint32Array(CHUNK_VOL);
  const noise  = makeNoise(worldSeed);
  const noise2 = makeNoise(worldSeed + 99);

  const seaLevel  = 4;
  const worldBase = cy * CHUNK_SIZE;

  for (let y = 0; y < CHUNK_SIZE; y++) {
    const wy = worldBase + y;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wz = cz * CHUNK_SIZE + z;
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * CHUNK_SIZE + x;
        const idx = x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;

        // Height field
        const n1 = noise(wx * 0.05, 0, wz * 0.05);
        const n2 = noise2(wx * 0.01, 0, wz * 0.01);
        const height = Math.round((n1 * 8 + n2 * 16) + seaLevel + 8);

        const biome = (n2 > 0.3) ? BIOMES.MOUNTAIN : (n2 < -0.3) ? BIOMES.OCEAN : BIOMES.PLAINS;
        const metaA = biome;

        if (wy === 0) {
          buf[idx] = voxel.pack(VOXEL_TYPES.BEDROCK, 0, metaA, 0);
        } else if (wy < height - 3) {
          buf[idx] = voxel.pack(VOXEL_TYPES.STONE, 0, metaA, 0);
        } else if (wy < height - 1) {
          buf[idx] = voxel.pack(VOXEL_TYPES.DIRT, 0, metaA, 0);
        } else if (wy < height) {
          const surface = biome === BIOMES.MOUNTAIN ? VOXEL_TYPES.STONE :
                          biome === BIOMES.OCEAN    ? VOXEL_TYPES.SAND  :
                          VOXEL_TYPES.GRASS;
          buf[idx] = voxel.pack(surface, 0, metaA, 0);
        } else if (wy < seaLevel && wy >= height) {
          buf[idx] = voxel.pack(VOXEL_TYPES.WATER, VOXEL_STATES.FLOWING, metaA, 0);
        } else {
          buf[idx] = voxel.pack(VOXEL_TYPES.AIR, 0, metaA, 0);
        }
      }
    }
  }
  return buf;
}

// ── Chunk class ───────────────────────────────────────────────────────────────

class Chunk {
  constructor(cx, cy, cz, buf = null) {
    this.cx    = cx;
    this.cy    = cy;
    this.cz    = cz;
    this.key   = chunkKey(cx, cy, cz);
    this.data  = buf ?? new Uint32Array(CHUNK_VOL);
    this.dirty = true;
    this.tick  = 0;  // last simulation tick this chunk was updated
  }

  get(x, y, z)         { return this.data[chunkIdx(x, y, z)]; }
  set(x, y, z, v)      { this.data[chunkIdx(x, y, z)] = v; this.dirty = true; }
  setIdx(idx, v)       { this.data[idx] = v; this.dirty = true; }
  getIdx(idx)          { return this.data[idx]; }

  /** Serialise to binary (header + raw buffer) */
  toBinary() {
    const header = Buffer.alloc(16);
    header.writeInt32LE(this.cx, 0);
    header.writeInt32LE(this.cy, 4);
    header.writeInt32LE(this.cz, 8);
    header.writeUInt32LE(this.tick, 12);
    return Buffer.concat([header, Buffer.from(this.data.buffer)]);
  }

  /** Deserialise from binary */
  static fromBinary(buf) {
    const cx   = buf.readInt32LE(0);
    const cy   = buf.readInt32LE(4);
    const cz   = buf.readInt32LE(8);
    const tick = buf.readUInt32LE(12);
    const data = new Uint32Array(buf.buffer, buf.byteOffset + 16, CHUNK_VOL);
    const c    = new Chunk(cx, cy, cz, new Uint32Array(data));
    c.tick     = tick;
    c.dirty    = false;
    return c;
  }
}

// ── World class ───────────────────────────────────────────────────────────────

export class VoxelWorld {
  constructor(id, options = {}) {
    this.id          = id;
    this.name        = options.name    ?? 'New World';
    this.seed        = options.seed    ?? Math.floor(Math.random() * 100000);
    this.dir         = join(WORLDS_DIR, id);
    this.chunks      = new Map();        // key → Chunk
    this.entities    = new Map();        // entityId → { type, x, y, z, data }
    this.rules       = options.rules   ?? {};
    this.tick        = 0;
    this.eventLog    = [];               // in-memory ring buffer
    this.maxLogSize  = 10000;
    this.taskRegions = new Map();        // taskId → { cx, cy, cz, radius }
    this.subscribers = new Set();        // SSE subscribers

    mkdirSync(this.dir, { recursive: true });
    this._logPath = join(this.dir, 'events.voxlog');
  }

  // ── Chunk access ─────────────────────────────────────────────────────────

  getChunk(cx, cy, cz) {
    const key = chunkKey(cx, cy, cz);
    if (!this.chunks.has(key)) {
      this._loadOrGenChunk(cx, cy, cz);
    }
    return this.chunks.get(key);
  }

  _loadOrGenChunk(cx, cy, cz) {
    const key      = chunkKey(cx, cy, cz);
    const filePath = join(this.dir, `${key}.bkgchunk`);

    if (existsSync(filePath)) {
      try {
        const buf   = readFileSync(filePath);
        const chunk = Chunk.fromBinary(buf);
        this.chunks.set(key, chunk);
        return chunk;
      } catch { /**/ }
    }

    // Generate new chunk
    const buf   = generateChunk(cx, cy, cz, this.seed);
    const chunk = new Chunk(cx, cy, cz, buf);
    this.chunks.set(key, chunk);
    return chunk;
  }

  // ── Voxel get/set ─────────────────────────────────────────────────────────

  getVoxel(wx, wy, wz) {
    const [cx, cy, cz] = worldToChunk(wx, wy, wz);
    return this.getChunk(cx, cy, cz).get(wx & 15, wy & 15, wz & 15);
  }

  setVoxel(wx, wy, wz, v, source = 'system') {
    const [cx, cy, cz] = worldToChunk(wx, wy, wz);
    const chunk = this.getChunk(cx, cy, cz);
    const old   = chunk.get(wx & 15, wy & 15, wz & 15);
    chunk.set(wx & 15, wy & 15, wz & 15, v);

    const evt = { type: 'voxel.set', wx, wy, wz, v, old, source, tick: this.tick, ts: Date.now() };
    this._emit(evt);
    return old;
  }

  // ── Entity system ─────────────────────────────────────────────────────────

  spawnEntity(type, x, y, z, data = {}) {
    const id     = randomBytes(4).toString('hex');
    const entity = { id, type, x, y, z, data, spawnedAt: this.tick };
    this.entities.set(id, entity);
    this._emit({ type: 'entity.spawn', entity, tick: this.tick, ts: Date.now() });
    // Mark voxel as occupied
    const vox = this.getVoxel(Math.round(x), Math.round(y), Math.round(z));
    this.setVoxel(Math.round(x), Math.round(y), Math.round(z),
      voxel.pack(voxel.type(vox), VOXEL_STATES.OCCUPIED, voxel.metaA(vox), voxel.metaB(vox)), 'entity');
    return entity;
  }

  moveEntity(id, dx, dy, dz) {
    const e = this.entities.get(id);
    if (!e) return null;
    e.x += dx; e.y += dy; e.z += dz;
    this._emit({ type: 'entity.move', id, x: e.x, y: e.y, z: e.z, tick: this.tick, ts: Date.now() });
    return e;
  }

  // ── bKG Flow integration: map tasks to voxel regions ─────────────────────

  assignTaskRegion(taskId, options = {}) {
    const cx = options.cx ?? Math.floor(this.taskRegions.size * 3);
    const cy = options.cy ?? 0;
    const cz = options.cz ?? 0;
    const r  = options.radius ?? 1;

    this.taskRegions.set(taskId, { cx, cy, cz, radius: r, status: 'todo' });

    // Mark the region with TASK_REGION voxels
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const wx = (cx + dx) * CHUNK_SIZE + 8;
        const wz = (cz + dz) * CHUNK_SIZE + 8;
        const wy = cy * CHUNK_SIZE + 1;
        this.setVoxel(wx, wy, wz,
          voxel.pack(VOXEL_TYPES.TASK_REGION, 0, 0, 0), `task:${taskId}`);
      }
    }

    this._emit({ type: 'task.region.assigned', taskId, cx, cy, cz, radius: r, tick: this.tick, ts: Date.now() });
    return { cx, cy, cz, radius: r };
  }

  updateTaskStatus(taskId, status) {
    const region = this.taskRegions.get(taskId);
    if (!region) return;
    region.status = status;

    // Visual update: change voxel type based on status
    const typeMap = {
      planning:     VOXEL_TYPES.CRYSTAL,
      todo:         VOXEL_TYPES.TASK_REGION,
      'in-progress': VOXEL_TYPES.DATA_CORE,
      review:       VOXEL_TYPES.QUERY_FIELD,
      done:         VOXEL_TYPES.CRYSTAL,
      archived:     VOXEL_TYPES.STONE,
    };

    const vt = typeMap[status] ?? VOXEL_TYPES.TASK_REGION;
    const { cx, cy, cz } = region;
    const wx = cx * CHUNK_SIZE + 8;
    const wz = cz * CHUNK_SIZE + 8;
    const wy = cy * CHUNK_SIZE + 2;
    this.setVoxel(wx, wy, wz, voxel.pack(vt, 0, 0, 0), `task-status:${taskId}`);
  }

  // ── Simulation tick (S1, S2) ──────────────────────────────────────────────

  simulate(ticks = 1) {
    for (let t = 0; t < ticks; t++) {
      this.tick++;
      this._simTick();
    }
    return this.tick;
  }

  _simTick() {
    // Only simulate loaded chunks
    for (const chunk of this.chunks.values()) {
      if (Math.random() > 0.3) continue;  // Stochastic update (performance)
      this._simChunk(chunk);
    }
  }

  _simChunk(chunk) {
    const { cx, cy, cz, data } = chunk;

    // Process each voxel bottom-up (gravity works correctly)
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const idx = x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
          const v   = data[idx];
          const vt  = voxel.type(v);

          if (vt === VOXEL_TYPES.AIR) continue;

          // Gravity: sand + gravel fall
          if (GRAVITY_RULES[vt]) {
            const wy    = cy * CHUNK_SIZE + y;
            const bvox  = y > 0
              ? data[x + z * CHUNK_SIZE + (y-1) * CHUNK_SIZE * CHUNK_SIZE]
              : this.getVoxel(cx*CHUNK_SIZE+x, wy-1, cz*CHUNK_SIZE+z);
            const btype = voxel.type(bvox);
            if (GRAVITY_RULES[vt].includes(btype)) {
              // Swap with below
              if (y > 0) {
                const bi = x + z * CHUNK_SIZE + (y-1) * CHUNK_SIZE * CHUNK_SIZE;
                data[idx]  = bvox;
                data[bi]   = voxel.pack(vt, VOXEL_STATES.FALLING, voxel.metaA(v), voxel.metaB(v));
                chunk.dirty = true;
              }
            }
          }

          // Fluid spread (simplified horizontal diffusion)
          const spread = FLUID_SPREAD[vt];
          if (spread && Math.random() < 1 / spread.viscosity) {
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            const dir  = dirs[Math.floor(Math.random() * 4)];
            const nx = x + dir[0], nz = z + dir[1];
            if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
              const ni = nx + nz * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
              if (voxel.isAir(data[ni])) {
                data[ni]   = voxel.pack(vt, VOXEL_STATES.FLOWING, voxel.metaA(v), Math.max(0, voxel.metaB(v)-1));
                chunk.dirty = true;
              }
            }
          }

          // Organic growth (rare)
          const grow = GROWTH_RULES[vt];
          if (grow && Math.random() < grow.chance && y < CHUNK_SIZE - 1) {
            const ai = x + z * CHUNK_SIZE + (y+1) * CHUNK_SIZE * CHUNK_SIZE;
            if (voxel.isAir(data[ai])) {
              data[ai]   = voxel.pack(grow.grow, 0, voxel.metaA(v), 0);
              chunk.dirty = true;
            }
          }
        }
      }
    }
  }

  // ── PROMPT.md → world rules compiler (B3) ─────────────────────────────────

  compilePrompt(promptMd) {
    const rules = { biomes: [], structures: [], entities: [], voxelOverrides: [] };

    // Extract world name
    const titleMatch = promptMd.match(/^#\s+(.+)/m);
    if (titleMatch) this.name = titleMatch[1].replace(/[🌍📖⚔️🛠️]/g, '').trim();

    // Detect biome keywords
    const biomeKeywords = {
      forest:   BIOMES.FOREST,   desert:   BIOMES.DESERT,
      ocean:    BIOMES.OCEAN,    mountain: BIOMES.MOUNTAIN,
      tundra:   BIOMES.TUNDRA,   jungle:   BIOMES.JUNGLE,
      swamp:    BIOMES.SWAMP,    volcanic: BIOMES.VOLCANO,
      crystal:  BIOMES.CRYSTAL_CAVE,
      space:    BIOMES.SPACE,    cyber:    BIOMES.CYBERSPACE,
    };
    const lower = promptMd.toLowerCase();
    for (const [kw, biomeId] of Object.entries(biomeKeywords)) {
      if (lower.includes(kw)) rules.biomes.push(biomeId);
    }

    // Detect NPC keywords → entity spawn points
    const npcMatches = [...promptMd.matchAll(/\*\*(.+?)\*\* \(([^)]+)\)/g)];
    for (const [, name, role] of npcMatches.slice(0, 8)) {
      rules.entities.push({ name, role: role.toLowerCase() });
    }

    // Detect tech/magic → voxel overrides
    if (lower.includes('crystal') || lower.includes('magic')) {
      rules.voxelOverrides.push({ replace: VOXEL_TYPES.STONE, with: VOXEL_TYPES.CRYSTAL, prob: 0.1 });
    }
    if (lower.includes('tech') || lower.includes('cyber') || lower.includes('circuit')) {
      rules.voxelOverrides.push({ replace: VOXEL_TYPES.STONE, with: VOXEL_TYPES.LOGIC_GATE, prob: 0.05 });
    }
    if (lower.includes('lava') || lower.includes('volcano') || lower.includes('fire')) {
      rules.voxelOverrides.push({ replace: VOXEL_TYPES.WATER, with: VOXEL_TYPES.LAVA, prob: 0.5 });
    }

    this.rules = rules;
    this._emit({ type: 'rule.apply', rules, source: 'prompt', tick: this.tick, ts: Date.now() });
    return rules;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  saveAll() {
    // Save metadata
    writeFileSync(join(this.dir, 'world.json'), JSON.stringify({
      id: this.id, name: this.name, seed: this.seed, tick: this.tick,
      chunkCount: this.chunks.size, entityCount: this.entities.size,
      rules: this.rules, taskRegions: Object.fromEntries(this.taskRegions),
      savedAt: Date.now(),
    }, null, 2));

    // Save dirty chunks
    let saved = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.dirty) {
        const path = join(this.dir, `${chunk.key}.bkgchunk`);
        writeFileSync(path, chunk.toBinary());
        chunk.dirty = false;
        saved++;
      }
    }

    return { saved, total: this.chunks.size };
  }

  static load(worldId) {
    const dir    = join(WORLDS_DIR, worldId);
    const mpath  = join(dir, 'world.json');
    if (!existsSync(mpath)) return null;

    const meta = JSON.parse(readFileSync(mpath, 'utf-8'));
    const w    = new VoxelWorld(worldId, { name: meta.name, seed: meta.seed });
    w.tick     = meta.tick;
    w.rules    = meta.rules ?? {};
    w.taskRegions = new Map(Object.entries(meta.taskRegions ?? {}));

    // Load entities from metadata
    return w;
  }

  // ── Serialisation helpers ─────────────────────────────────────────────────

  /** Serialise a single chunk as JSON (for API responses) */
  chunkToJSON(cx, cy, cz) {
    const chunk  = this.getChunk(cx, cy, cz);
    const sparse = [];  // only non-air voxels

    for (let i = 0; i < CHUNK_VOL; i++) {
      const v = chunk.data[i];
      if (!voxel.isAir(v)) {
        const x = i & 15;
        const z = (i >> 4) & 15;
        const y = (i >> 8) & 15;
        sparse.push({ x, y, z, v, type: voxel.type(v), color: voxel.color(v) });
      }
    }

    return {
      cx, cy, cz, key: chunk.key, tick: chunk.tick,
      voxels: sparse, voxelCount: sparse.length,
    };
  }

  /** Compact binary chunk for WebSocket/fetch streaming */
  chunkToBinary(cx, cy, cz) {
    return this.getChunk(cx, cy, cz).toBinary();
  }

  getWorldInfo() {
    return {
      id: this.id, name: this.name, seed: this.seed, tick: this.tick,
      chunkCount: this.chunks.size, entityCount: this.entities.size,
      loadedChunks: [...this.chunks.keys()],
      taskRegions: Object.fromEntries(this.taskRegions),
    };
  }

  // ── Events ────────────────────────────────────────────────────────────────

  _emit(event) {
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) this.eventLog.shift();

    // Persist to JSONL
    try {
      appendFileSync(this._logPath, JSON.stringify(event) + '\n');
    } catch { /**/ }

    // Notify SSE subscribers
    for (const fn of this.subscribers) {
      try { fn(event); } catch { /**/ }
    }
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  getEvents(since = 0, limit = 200) {
    return this.eventLog.filter(e => e.ts >= since).slice(-limit);
  }

  /** Replay world from event log (deterministic) */
  replayFromLog() {
    if (!existsSync(this._logPath)) return 0;
    const lines = readFileSync(this._logPath, 'utf-8').trim().split('\n').filter(Boolean);
    let applied = 0;
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'voxel.set') {
          const [cx, cy, cz] = worldToChunk(evt.wx, evt.wy, evt.wz);
          const chunk = this.getChunk(cx, cy, cz);
          chunk.set(evt.wx & 15, evt.wy & 15, evt.wz & 15, evt.v);
          applied++;
        }
      } catch { /**/ }
    }
    return applied;
  }
}

// ── World registry ────────────────────────────────────────────────────────────

const _worlds = new Map();

export function createWorld(options = {}) {
  const id    = options.id ?? randomBytes(4).toString('hex');
  const world = new VoxelWorld(id, options);
  _worlds.set(id, world);
  // Pre-generate spawn area (3×3×1 chunks at sea level)
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      world.getChunk(cx, 0, cz);  // loads/generates
      world.getChunk(cx, 1, cz);  // above-ground layer
    }
  }
  return world;
}

export function getWorld(id) {
  if (_worlds.has(id)) return _worlds.get(id);
  // Try loading from disk
  const world = VoxelWorld.load(id);
  if (world) { _worlds.set(id, world); return world; }
  return null;
}

export function listWorlds() {
  const onDisk = existsSync(WORLDS_DIR)
    ? readdirSync(WORLDS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
    : [];

  const inMemory = [..._worlds.keys()];
  const all = [...new Set([...onDisk, ...inMemory])];

  return all.map(id => {
    const w = _worlds.get(id);
    if (w) return { id, name: w.name, tick: w.tick, chunks: w.chunks.size, entities: w.entities.size, inMemory: true };
    const mpath = join(WORLDS_DIR, id, 'world.json');
    if (existsSync(mpath)) {
      try {
        const meta = JSON.parse(readFileSync(mpath, 'utf-8'));
        return { id, name: meta.name, tick: meta.tick, chunks: meta.chunkCount, inMemory: false, savedAt: meta.savedAt };
      } catch { /**/ }
    }
    return { id, inMemory: false };
  });
}

export function deleteWorld(id) {
  _worlds.delete(id);
  const dir = join(WORLDS_DIR, id);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      try { require('fs').unlinkSync(join(dir, f)); } catch { /**/ }
    }
  }
}

// ── WASM bridge (N1, N2) — ready for hot-swap with real WASM module ───────────

/**
 * bKGVoxelKernel — simulates the WASM module interface.
 * When a real WASM kernel is available, swap this class for the WASM imports.
 *
 * Interface contract (identical to what AssemblyScript WASM export would look like):
 *   kernel.tick(worldPtr, chunkCount)   → ticks updated
 *   kernel.setVoxel(ptr, idx, v)        → void
 *   kernel.getVoxel(ptr, idx)           → uint32
 *   kernel.applyRule(worldPtr, ruleId)  → mutations applied
 */
export class BKGVoxelKernel {
  constructor() {
    this._wasmModule = null;  // will hold WebAssembly.Instance when loaded
    this._memory     = null;  // WebAssembly.Memory (SharedArrayBuffer)
  }

  /** Load a compiled WASM kernel from path */
  async loadWASM(wasmPath) {
    if (!existsSync(wasmPath)) {
      console.log('[voxel-kernel] WASM not found at', wasmPath, '— using JS kernel');
      return false;
    }
    try {
      const buf    = readFileSync(wasmPath);
      const mod    = await WebAssembly.compile(buf);
      this._memory = new WebAssembly.Memory({ initial: 256, maximum: 1024, shared: true });
      const inst   = await WebAssembly.instantiate(mod, {
        env: { memory: this._memory, abort: () => {} },
      });
      this._wasmModule = inst.exports;
      console.log('[voxel-kernel] WASM kernel loaded from', wasmPath);
      return true;
    } catch (e) {
      console.warn('[voxel-kernel] WASM load failed:', e.message, '— using JS kernel');
      return false;
    }
  }

  /** Simulate ticks on a world using WASM or JS fallback */
  tick(world, ticks = 1) {
    if (this._wasmModule?.tick) {
      // WASM path: copy chunk data to linear memory, run, copy back
      // (implementation mirrors the JS path but via WASM linear memory)
      return this._wasmModule.tick(ticks);
    }
    // JS fallback (identical logic)
    return world.simulate(ticks);
  }

  get isWASM() { return !!this._wasmModule; }
}

export const kernel = new BKGVoxelKernel();
// Try to load WASM kernel on startup
kernel.loadWASM(join(__dirname ?? process.cwd(), 'bkg-voxel-kernel.wasm')).catch(() => {});

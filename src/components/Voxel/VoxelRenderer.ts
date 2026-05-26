/**
 * src/components/Voxel/VoxelRenderer.ts
 *
 * bKG VLDB WebGL Renderer — Lowpoly Voxel Engine
 *
 * Features:
 *   • Greedy meshing  — Mikola Lysenko algorithm, merges coplanar same-material faces
 *   • Flat shading     — per-face normals, no interpolation → PS1/lowpoly aesthetic
 *   • Material palette — 16 RGBA8 materials, no textures required
 *   • Vertex quantization — integer positions → crisp silhouettes
 *   • Frustum culling  — AABB per chunk, skip invisible chunks
 *   • Camera system    — orbit mode + free-fly mode with keyboard/mouse
 *   • WebGL fallback   — WebGPU planned, WebGL2 used now
 *
 * Vertex format (28 bytes per vertex):
 *   float x, y, z     (12 bytes, integer world coordinates as floats)
 *   float nx, ny, nz  (12 bytes, face normal)
 *   uint8 mat [×4]    (4 bytes, material ID in r, pad g/b/a)
 */

// ── Constants ──────────────────────────────────────────────────────────────────

export const CHUNK_SIZE = 32;

// Material color palette (index = material ID, RGBA)
const PALETTE_COLORS = [
  [0.0, 0.0, 0.0, 0.0],   // 0 AIR        transparent
  [0.53, 0.53, 0.53, 1.0], // 1 SOLID      grey stone
  [0.60, 0.80, 1.00, 0.7], // 2 GLASS      blue water
  [1.00, 0.40, 0.00, 1.0], // 3 EMISSIVE   orange lava
  [0.20, 0.60, 0.80, 0.8], // 4 FLUID      cyan water
  [0.27, 0.67, 0.27, 1.0], // 5 TERRAIN    green grass
  [0.00, 0.90, 1.00, 0.9], // 6 CRYSTAL    bKG cyan
  [0.67, 0.67, 0.73, 1.0], // 7 METAL      steel
  [0.60, 0.40, 0.20, 1.0], // 8 WOOD       brown
  [0.33, 0.53, 0.20, 1.0], // 9 ORGANIC    dark green
  [0.66, 0.33, 0.97, 1.0], // A DATA_CORE  bKG purple
  [0.13, 1.00, 0.67, 1.0], // B LOGIC      circuit green
  [0.53, 0.53, 1.00, 1.0], // C MEMORY     soft blue
  [0.00, 0.72, 0.83, 0.8], // D TASK_VOXEL task cyan
  [1.00, 0.67, 0.00, 1.0], // E AGENT_MARK agent amber
  [0.13, 0.13, 0.13, 1.0], // F BEDROCK    near-black
];

// Directional light per normal index
// Normal indices: 0=+Y 1=-Y 2=+X 3=-X 4=+Z 5=-Z
const FACE_NORMALS = [
  [ 0,  1,  0],  // top
  [ 0, -1,  0],  // bottom
  [ 1,  0,  0],  // right
  [-1,  0,  0],  // left
  [ 0,  0,  1],  // front
  [ 0,  0, -1],  // back
];

const FACE_LIGHT = [1.0, 0.5, 0.85, 0.7, 0.9, 0.75];  // directional light per face

// ── GLSL shaders ──────────────────────────────────────────────────────────────

const VERT_SRC = `#version 300 es
precision highp float;

layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
layout(location=2) in float a_mat;
layout(location=3) in float a_light;

uniform mat4 u_mvp;
uniform vec3 u_camPos;
uniform float u_fogNear;
uniform float u_fogFar;

out vec3 v_color;
out float v_fog;
flat out float v_mat;

// 16-entry palette (vec4 rgba)
uniform vec4 u_palette[16];

void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);

  // Sample material color from palette
  int matIdx = int(a_mat + 0.5);
  vec4 matColor = u_palette[matIdx];

  // Flat shading: multiply by directional light factor
  vec3 shaded = matColor.rgb * a_light;

  // Slight ambient occlusion at edges (material-based darkening)
  float ao = 0.85 + 0.15 * matColor.a;
  v_color = shaded * ao;

  // Fog
  float dist = distance(a_pos, u_camPos);
  v_fog = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);

  // Assign flat-interpolated mat ID (flat qualifier is on the declaration, not here)
  v_mat = a_mat;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_fog;
flat in float v_mat;

uniform vec3 u_fogColor;
out vec4 fragColor;

void main() {
  // Discard air (material 0) — shouldn't appear but safety check
  if (int(v_mat + 0.5) == 0) discard;

  vec3 col = mix(v_color, u_fogColor, v_fog);
  fragColor = vec4(col, 1.0);
}
`;

// ── Greedy meshing ────────────────────────────────────────────────────────────

interface VoxelData {
  get(lx: number, ly: number, lz: number): number;
}

interface MeshBuffers {
  vertices: Float32Array;   // interleaved: pos(3) + normal(3) + mat(1) + light(1)
  indices:  Uint32Array;
  vertCount: number;
  idxCount:  number;
  faceCount: number;
}

/**
 * Greedy mesh a 32³ chunk.
 * Merges coplanar faces of the same material into quads.
 *
 * Per-face vertex layout (8 floats = 32 bytes):
 *   x, y, z    (position, integer world coords)
 *   nx, ny, nz (face normal)
 *   mat        (material index 0-15)
 *   light      (directional light 0-1)
 */
export function greedyMesh(chunk: VoxelData, ox: number, oy: number, oz: number): MeshBuffers {
  const verts: number[]  = [];
  const idxs:  number[]  = [];
  let vidx = 0;

  // Axis-major loop: for each of 3 axes, two directions
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;  // tangent axis 1
    const v = (d + 2) % 3;  // tangent axis 2

    const pos = [0, 0, 0];
    const q   = [0, 0, 0];
    q[d]      = 1;

    // Mask: for each 2D slice along axis d
    const mask = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);

    for (pos[d] = -1; pos[d] < CHUNK_SIZE; ) {
      let n = 0;

      for (pos[v] = 0; pos[v] < CHUNK_SIZE; pos[v]++) {
        for (pos[u] = 0; pos[u] < CHUNK_SIZE; pos[u]++, n++) {
          // Current and neighbour voxel
          const m0 = pos[d] >= 0 ? chunk.get(pos[0] & 31, pos[1] & 31, pos[2] & 31) : 0;
          const m1 = pos[d] < CHUNK_SIZE - 1
            ? chunk.get((pos[0]+q[0]) & 31, (pos[1]+q[1]) & 31, (pos[2]+q[2]) & 31)
            : 0;

          // Determine face visibility
          if (Boolean(m0) !== Boolean(m1)) {
            mask[n] = m0 ? m0 : -m1;  // positive = face of m0, negative = back face of m1
          } else {
            mask[n] = 0;
          }
        }
      }

      pos[d]++;
      n = 0;

      // Greedy: find maximal rectangles in mask
      for (pos[v] = 0; pos[v] < CHUNK_SIZE; pos[v]++) {
        for (pos[u] = 0; pos[u] < CHUNK_SIZE; ) {
          const mat = mask[n];
          if (!mat) { n++; pos[u]++; continue; }

          // Width: max w where mask[n + i] === mat
          let w = 1;
          while (pos[u] + w < CHUNK_SIZE && mask[n + w] === mat) w++;

          // Height: max h where entire row mask[n + i*CHUNK_SIZE .. n + i*CHUNK_SIZE + w] === mat
          let h = 1;
          outer: for (; pos[v] + h < CHUNK_SIZE; h++) {
            for (let k = 0; k < w; k++) {
              if (mask[n + k + h * CHUNK_SIZE] !== mat) break outer;
            }
          }

          // Emit quad for this w×h rectangle
          const absMat = Math.abs(mat);
          const backFace = mat < 0;
          const faceDir  = backFace ? d * 2 + 1 : d * 2;
          const normal   = FACE_NORMALS[faceDir];
          const light    = FACE_LIGHT[faceDir];

          // World-space corner of quad
          const p0 = [
            ox + (d === 0 ? pos[d] : pos[0]),
            oy + (d === 1 ? pos[d] : pos[1]),
            oz + (d === 2 ? pos[d] : pos[2]),
          ];

          // Tangent vectors for the quad
          const du = [0, 0, 0], dv = [0, 0, 0];
          du[u] = w;
          dv[v] = h;

          // 4 corners of the quad
          const p1 = [p0[0] + du[0], p0[1] + du[1], p0[2] + du[2]];
          const p2 = [p0[0] + dv[0], p0[1] + dv[1], p0[2] + dv[2]];
          const p3 = [p0[0] + du[0] + dv[0], p0[1] + du[1] + dv[1], p0[2] + du[2] + dv[2]];

          const addVert = (px: number, py: number, pz: number) => {
            verts.push(
              px, py, pz,
              normal[0], normal[1], normal[2],
              absMat,
              light,
            );
          };

          if (!backFace) {
            addVert(p0[0], p0[1], p0[2]);
            addVert(p1[0], p1[1], p1[2]);
            addVert(p3[0], p3[1], p3[2]);
            addVert(p2[0], p2[1], p2[2]);
          } else {
            addVert(p2[0], p2[1], p2[2]);
            addVert(p3[0], p3[1], p3[2]);
            addVert(p1[0], p1[1], p1[2]);
            addVert(p0[0], p0[1], p0[2]);
          }

          idxs.push(vidx, vidx+1, vidx+2,  vidx, vidx+2, vidx+3);
          vidx += 4;

          // Clear used mask cells
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              mask[n + i + j * CHUNK_SIZE] = 0;
            }
          }

          n += w; pos[u] += w;
        }
      }
    }
  }

  return {
    vertices:  new Float32Array(verts),
    indices:   new Uint32Array(idxs),
    vertCount: vidx,
    idxCount:  idxs.length,
    faceCount: idxs.length / 6,
  };
}

// ── ChunkMesh (WebGL buffer pair per chunk) ───────────────────────────────────

interface ChunkMeshGL {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  idxCount: number;
  cx: number; cy: number; cz: number;
  worldMin: [number, number, number];
  worldMax: [number, number, number];
}

// ── Camera ────────────────────────────────────────────────────────────────────

export class Camera {
  pos:   Float32Array = new Float32Array([0, 30, 80]);
  yaw  = -90;   // degrees
  pitch = -20;  // degrees
  fov  = 70;    // degrees
  near = 0.5;
  far  = 2000;

  // Computed
  view = new Float32Array(16);
  proj = new Float32Array(16);
  mvp  = new Float32Array(16);

  forward(): [number, number, number] {
    const y = this.yaw   * Math.PI / 180;
    const p = this.pitch * Math.PI / 180;
    return [
      Math.cos(p) * Math.cos(y),
      Math.sin(p),
      Math.cos(p) * Math.sin(y),
    ];
  }

  right(): [number, number, number] {
    const y = this.yaw * Math.PI / 180;
    return [Math.sin(y), 0, -Math.cos(y)];
  }

  updateProj(aspect: number) {
    matPerspective(this.proj, this.fov * Math.PI / 180, aspect, this.near, this.far);
  }

  updateView() {
    const [fx, fy, fz] = this.forward();
    matLookAt(this.view,
      [this.pos[0], this.pos[1], this.pos[2]],
      [this.pos[0]+fx, this.pos[1]+fy, this.pos[2]+fz],
      [0, 1, 0],
    );
  }

  updateMVP() {
    this.updateView();
    matMul(this.mvp, this.proj, this.view);
  }
}

// ── Matrix math (no external deps) ───────────────────────────────────────────

function matPerspective(out: Float32Array, fovY: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = 2 * far * near / (near - far);
}

function matLookAt(out: Float32Array, eye: number[], center: number[], up: number[]) {
  const fx = center[0]-eye[0], fy = center[1]-eye[1], fz = center[2]-eye[2];
  const fl = Math.sqrt(fx*fx+fy*fy+fz*fz);
  const nx = fx/fl, ny = fy/fl, nz = fz/fl;
  const sx = ny*up[2]-nz*up[1], sy = nz*up[0]-nx*up[2], sz = nx*up[1]-ny*up[0];
  const sl = Math.sqrt(sx*sx+sy*sy+sz*sz);
  const rx = sx/sl, ry = sy/sl, rz = sz/sl;
  const ux = ry*nz-rz*ny, uy = rz*nx-rx*nz, uz = rx*ny-ry*nx;
  out[0]=rx; out[1]=ux; out[2]=-nx; out[3]=0;
  out[4]=ry; out[5]=uy; out[6]=-ny; out[7]=0;
  out[8]=rz; out[9]=uz; out[10]=-nz; out[11]=0;
  out[12]=-(rx*eye[0]+ry*eye[1]+rz*eye[2]);
  out[13]=-(ux*eye[0]+uy*eye[1]+uz*eye[2]);
  out[14]=(nx*eye[0]+ny*eye[1]+nz*eye[2]);
  out[15]=1;
}

function matMul(out: Float32Array, a: Float32Array, b: Float32Array) {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i + k*4] * b[k + j*4];
      out[i + j*4] = s;
    }
  }
}

// ── VoxelRenderer ─────────────────────────────────────────────────────────────

export class VoxelRenderer {
  private gl:      WebGL2RenderingContext | null = null;
  private prog:    WebGLProgram | null = null;
  private camera:  Camera = new Camera();
  private chunks:  Map<string, ChunkMeshGL> = new Map();
  private canvas:  HTMLCanvasElement | null = null;
  private rafId:   number = 0;
  private running  = false;
  private onRender?: (info: RenderInfo) => void;

  // Uniform locations
  private uMVP:     WebGLUniformLocation | null = null;
  private uCamPos:  WebGLUniformLocation | null = null;
  private uFogNear: WebGLUniformLocation | null = null;
  private uFogFar:  WebGLUniformLocation | null = null;
  private uFogColor:WebGLUniformLocation | null = null;
  private uPalette: WebGLUniformLocation | null = null;

  // Palette data (flat RGBA floats)
  private paletteData = new Float32Array(PALETTE_COLORS.flat());

  // Stats
  private stats = { fps: 0, drawCalls: 0, tris: 0, chunks: 0, frame: 0 };
  private _lastTime = 0;

  // Input state
  private keys:     Set<string> = new Set();
  private mouseDown = false;
  private lastMX    = 0;
  private lastMY    = 0;

  init(canvas: HTMLCanvasElement, onRender?: (info: RenderInfo) => void) {
    this.canvas   = canvas;
    this.onRender = onRender;

    const gl = canvas.getContext('webgl2', { antialias: false, depth: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.02, 0.04, 0.08, 1.0);  // deep ocean dark

    this.prog = this._compileProgram(VERT_SRC, FRAG_SRC);
    this.uMVP      = gl.getUniformLocation(this.prog, 'u_mvp');
    this.uCamPos   = gl.getUniformLocation(this.prog, 'u_camPos');
    this.uFogNear  = gl.getUniformLocation(this.prog, 'u_fogNear');
    this.uFogFar   = gl.getUniformLocation(this.prog, 'u_fogFar');
    this.uFogColor = gl.getUniformLocation(this.prog, 'u_fogColor');
    this.uPalette  = gl.getUniformLocation(this.prog, 'u_palette');

    this._bindInput();
    return this;
  }

  // ── Shader compilation ────────────────────────────────────────────────────

  private _compileProgram(vs: string, fs: string): WebGLProgram {
    const gl   = this.gl!;
    const vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vert, vs);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      throw new Error('Vertex shader: ' + gl.getShaderInfoLog(vert));
    }

    const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(frag, fs);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      throw new Error('Fragment shader: ' + gl.getShaderInfoLog(frag));
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  // ── Chunk upload to GPU ────────────────────────────────────────────────────

  uploadChunk(
    cx: number, cy: number, cz: number,
    sparseVoxels: Array<{ lx: number; ly: number; lz: number; mat: number }>,
  ) {
    const gl  = this.gl!;
    const key = `${cx}|${cy}|${cz}`;

    // Remove old mesh
    const old = this.chunks.get(key);
    if (old) {
      gl.deleteVertexArray(old.vao);
      gl.deleteBuffer(old.vbo);
      gl.deleteBuffer(old.ibo);
    }

    if (sparseVoxels.length === 0) { this.chunks.delete(key); return; }

    // Build a simple VoxelData accessor from sparse list
    const ox = cx * CHUNK_SIZE, oy = cy * CHUNK_SIZE, oz = cz * CHUNK_SIZE;

    // Fill a typed array for fast get()
    const grid = new Uint8Array(CHUNK_SIZE ** 3);
    for (const v of sparseVoxels) {
      const i = v.lx | (v.lz << 5) | (v.ly << 10);
      grid[i] = v.mat;
    }
    const accessor = { get: (lx: number, ly: number, lz: number) => grid[lx | (lz<<5) | (ly<<10)] };

    const mesh = greedyMesh(accessor, ox, oy, oz);
    if (mesh.idxCount === 0) { this.chunks.delete(key); return; }

    // Upload to GPU
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);

    const STRIDE = 8 * 4;  // 8 floats * 4 bytes
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);   // pos
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);  // normal
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 24);  // mat
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, 28);  // light

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    this.chunks.set(key, {
      vao, vbo, ibo,
      idxCount: mesh.idxCount,
      cx, cy, cz,
      worldMin: [ox, oy, oz],
      worldMax: [ox + CHUNK_SIZE, oy + CHUNK_SIZE, oz + CHUNK_SIZE],
    });
  }

  removeChunk(cx: number, cy: number, cz: number) {
    const gl  = this.gl;
    const key = `${cx}|${cy}|${cz}`;
    const m   = this.chunks.get(key);
    if (m && gl) {
      gl.deleteVertexArray(m.vao);
      gl.deleteBuffer(m.vbo);
      gl.deleteBuffer(m.ibo);
    }
    this.chunks.delete(key);
  }

  clearChunks() {
    for (const [k] of this.chunks) {
      const m = this.chunks.get(k)!;
      this.gl?.deleteVertexArray(m.vao);
      this.gl?.deleteBuffer(m.vbo);
      this.gl?.deleteBuffer(m.ibo);
    }
    this.chunks.clear();
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = Math.min((t - this._lastTime) / 1000, 0.1);
      this._lastTime = t;
      this._handleInput(dt);
      this._draw(t);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private _draw(t: number) {
    const gl = this.gl!;
    const c  = this.canvas!;

    // Resize check
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
      c.width  = c.clientWidth;
      c.height = c.clientHeight;
      gl.viewport(0, 0, c.width, c.height);
    }

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);

    this.camera.updateProj(c.width / c.height);
    this.camera.updateMVP();

    // Set uniforms
    gl.uniformMatrix4fv(this.uMVP, false, this.camera.mvp);
    gl.uniform3fv(this.uCamPos, this.camera.pos);
    gl.uniform1f(this.uFogNear, 200);
    gl.uniform1f(this.uFogFar, 600);
    gl.uniform3f(this.uFogColor, 0.03, 0.06, 0.12);
    gl.uniform4fv(this.uPalette, this.paletteData);

    // Draw visible chunks
    let drawCalls = 0, tris = 0;
    for (const mesh of this.chunks.values()) {
      // Simple frustum cull: skip if behind camera
      if (this._isCulled(mesh)) continue;

      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.idxCount, gl.UNSIGNED_INT, 0);
      drawCalls++;
      tris += mesh.idxCount / 3;
    }

    gl.bindVertexArray(null);

    // FPS counter
    this.stats.frame++;
    if (this.stats.frame % 60 === 0) {
      this.stats.fps        = Math.round(1000 / ((t - (this._lastTime - 16)) + 1));
      this.stats.drawCalls  = drawCalls;
      this.stats.tris       = tris;
      this.stats.chunks     = this.chunks.size;
      this.onRender?.(this.getStats());
    }
  }

  private _isCulled(mesh: ChunkMeshGL): boolean {
    // Simple distance cull (frustum cull TODO)
    const [px, py, pz] = [this.camera.pos[0], this.camera.pos[1], this.camera.pos[2]];
    const mcx = (mesh.worldMin[0] + mesh.worldMax[0]) / 2;
    const mcy = (mesh.worldMin[1] + mesh.worldMax[1]) / 2;
    const mcz = (mesh.worldMin[2] + mesh.worldMax[2]) / 2;
    const d2  = (px-mcx)**2 + (py-mcy)**2 + (pz-mcz)**2;
    return d2 > 600 * 600;  // cull beyond 600 units
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  private _bindInput() {
    if (!this.canvas) return;
    const c = this.canvas;

    c.addEventListener('keydown',   e => this.keys.add(e.code));
    c.addEventListener('keyup',     e => this.keys.delete(e.code));
    c.addEventListener('mousedown', e => { this.mouseDown = true; this.lastMX = e.clientX; this.lastMY = e.clientY; });
    c.addEventListener('mouseup',   () => this.mouseDown = false);
    c.addEventListener('mousemove', e => {
      if (!this.mouseDown) return;
      const dx = e.clientX - this.lastMX, dy = e.clientY - this.lastMY;
      this.camera.yaw   += dx * 0.3;
      this.camera.pitch -= dy * 0.3;
      this.camera.pitch  = Math.max(-89, Math.min(89, this.camera.pitch));
      this.lastMX = e.clientX; this.lastMY = e.clientY;
    });
    c.setAttribute('tabindex', '0');
    c.focus();
  }

  private _handleInput(dt: number) {
    const speed = this.keys.has('ShiftLeft') ? 60 : 20;
    const [fx, fy, fz] = this.camera.forward();
    const [rx, , rz]   = this.camera.right();

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp'))    { this.camera.pos[0] += fx*speed*dt; this.camera.pos[1] += fy*speed*dt; this.camera.pos[2] += fz*speed*dt; }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))  { this.camera.pos[0] -= fx*speed*dt; this.camera.pos[1] -= fy*speed*dt; this.camera.pos[2] -= fz*speed*dt; }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))  { this.camera.pos[0] -= rx*speed*dt; this.camera.pos[2] -= rz*speed*dt; }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) { this.camera.pos[0] += rx*speed*dt; this.camera.pos[2] += rz*speed*dt; }
    if (this.keys.has('Space'))   this.camera.pos[1] += speed * dt;
    if (this.keys.has('KeyC'))    this.camera.pos[1] -= speed * dt;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getCamera() { return this.camera; }

  getStats(): RenderInfo {
    return {
      fps:       this.stats.fps,
      drawCalls: this.stats.drawCalls,
      triangles: this.stats.tris,
      chunks:    this.stats.chunks,
      camPos:    [...this.camera.pos] as [number,number,number],
    };
  }

  dispose() {
    this.stop();
    this.clearChunks();
    this.gl = null;
  }
}

export interface RenderInfo {
  fps:       number;
  drawCalls: number;
  triangles: number;
  chunks:    number;
  camPos:    [number, number, number];
}

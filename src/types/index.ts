// ICADP 3.0 – Core Type Definitions

/** The five top-level stages. 'home' is the landing dashboard. */
export type Stage = 'home' | 'stufe1' | 'stufe1_5' | 'stufe2' | 'stufe3';
export type Stufe1Step = 'idea' | 'features' | 'generating';
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'generating' | 'error';
/** Inference backend selection.
 *  webgpu     – @mlc-ai/web-llm running in-browser via WebGPU (no server)
 *  ollama     – local `ollama serve` (OpenAI-compatible REST)
 *  llama-cpp  – bundled node-llama-cpp Express server in server/ (GGUF, GPU auto-detect)
 */
export type BackendType = 'webgpu' | 'ollama' | 'llama-cpp';

export interface BackendConfig {
  type: BackendType;
  serverUrl: string;
  modelId: string;
}

export type FeaturePriority  = 'high' | 'medium' | 'low';
export type FeatureComplexity = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface FeatureProposal {
  id:          string;
  title:       string;
  rationale:   string;
  accepted:    boolean;
  priority:    FeaturePriority;
  complexity:  FeatureComplexity;
  techHint?:   string;
}

export interface ManifestEntry {
  path: string;
  role: string;
  layer: string;
  priority: 'high' | 'medium' | 'low';
}

export interface GeneratedBundle {
  'agent.md': string;
  'architecture.md': string;
  'roadmap.md': string;
  'tasks.md': string;
  'manifest.json': string;
}

export type BundleFileName = keyof GeneratedBundle;

export type ValidationStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail';
export type ValidationCheckId = 'redundancy' | 'overkill' | 'task-operability' | 'dependency' | 'mvp-scope';

export interface ValidationStep {
  id: ValidationCheckId;
  title: string;
  description: string;
  status: ValidationStatus;
  findings: string[];
}

export interface ValidationResult {
  steps: ValidationStep[];
  passed: boolean;
  completedAt?: string;
}

export interface SimulationLogEntry {
  id: string;
  timestamp: number;
  action: 'info' | 'create' | 'write' | 'success' | 'error';
  message: string;
  filePath?: string;
}

export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  content?: string;
  isNew?: boolean;
  children?: FileTreeNode[];
}

export interface Project {
  id: string;
  idea_text: string;
  proposed_features: FeatureProposal[];
  generated_bundle: GeneratedBundle | null;
  validation_results: ValidationResult | null;
  created_at: string;
  updated_at: string;
}

export interface EngineProgress { progress: number; text: string; }

// ── Pi Agent / ICADP Coding Agent ─────────────────────────────────────────────

/** A live agent session (backed by pi-agent-core). */
export interface AgentSession {
  sessionId: string;
  cwd:       string;
  model:     string;
  startedAt: string;
  eventCount: number;
}

/** An agent event streamed from the server. */
export interface AgentEvent {
  type:       string;
  _ts:        number;
  _session:   string;
  // message_update
  assistantMessageEvent?: { type: string; delta?: string; text?: string };
  // tool_call / tool_result
  toolName?:  string;
  toolCallId?:string;
  input?:     Record<string, unknown>;
  result?:    { content: Array<{ type: string; text?: string }>; isError: boolean };
  // agent_start / agent_end
  messages?:  unknown[];
}

/** Agent settings stored at ~/.icadp/settings.json */
export interface AgentSettings {
  backendType:         'llama-cpp' | 'ollama';
  serverUrl:           string;
  modelId:             string;
  tools:               string[];
  systemPromptPrefix:  string;
  defaultCwd:          string;
  contextWindow:       number;
  maxTokens:           number;
}

/** An installed pi-compatible plugin. */
export interface Plugin {
  source:      string;
  type:        'npm' | 'git';
  name:        string;
  version?:    string;
  installDir:  string;
  resources:   {
    extensions: string[];
    skills:     string[];
    prompts:    string[];
    themes:     string[];
  };
  installedAt: string;
  enabled:     boolean;
}

/** npm search result for pi packages */
export interface PluginSearchResult {
  name:        string;
  version:     string;
  description: string;
  keywords:    string[];
  source:      string;  // "npm:@scope/pkg"
}

// ── Code Studio ────────────────────────────────────────────────────────────────

/** A real generated code file (not simulated). */
export interface ProjectFile {
  path:        string;    // relative path, e.g. "src/db.ts"
  content:     string;    // full file content
  language:    string;    // monaco language id, e.g. "typescript"
  role:        string;    // from manifest, e.g. "Database layer"
  isStreaming: boolean;   // true while LLM is writing it
  versionIdx:  number;    // which version snapshot this belongs to
}

/** A versioned snapshot of the project files at a milestone. */
export interface CodeVersion {
  idx:         number;
  label:       string;     // e.g. "Phase 1 — Foundation"
  timestamp:   string;     // ISO
  files:       ProjectFile[];
  filesCount:  number;
}

/** A chat message in the agent dialogue. */
export interface AgentMessage {
  id:        string;
  role:      'agent' | 'user';
  content:   string;
  timestamp: string;
}

/** State for the milestone pause dialog. */
export interface MilestoneState {
  phase:        number;        // 1, 2, 3
  label:        string;
  filesWritten: number;
  totalFiles:   number;
  suggestedFeatures: string[]; // agent's suggestions for next features
}

export interface AppState {
  stage: Stage;
  stufe1Step: Stufe1Step;
  project: Project | null;
  editableBundle: GeneratedBundle | null;
  modifiedFiles: Set<BundleFileName>;
  backendConfig: BackendConfig;
  engineStatus: EngineStatus;
  engineProgress: EngineProgress;
  generatingFileName: BundleFileName | null;
  streamBuffer: string;
  validationResult: ValidationResult | null;
  simulationLogs: SimulationLogEntry[];
  simulationRunning: boolean;
  simulationVirtualTree: FileTreeNode[];
  // Code Studio
  projectFiles:    ProjectFile[];
  selectedFilePath: string | null;
  versions:        CodeVersion[];
  agentMessages:   AgentMessage[];
  milestone:       MilestoneState | null;
  codegenRunning:  boolean;
  globalError: string | null;
}

export type AppAction =
  | { type: 'SET_STAGE'; stage: Stage }
  | { type: 'SET_STUFE1_STEP'; step: Stufe1Step }
  | { type: 'SET_PROJECT'; project: Project }
  | { type: 'CLEAR_PROJECT' }
  | { type: 'SET_FEATURES'; features: FeatureProposal[] }
  | { type: 'TOGGLE_FEATURE'; id: string }
  | { type: 'SET_BACKEND'; config: BackendConfig }
  | { type: 'SET_ENGINE_STATUS'; status: EngineStatus }
  | { type: 'SET_ENGINE_PROGRESS'; progress: EngineProgress }
  | { type: 'SET_GENERATING_FILE'; fileName: BundleFileName | null }
  | { type: 'APPEND_STREAM'; chunk: string }
  | { type: 'CLEAR_STREAM' }
  | { type: 'SET_BUNDLE'; bundle: GeneratedBundle }
  | { type: 'UPDATE_BUNDLE_FILE'; fileName: BundleFileName; content: string }
  | { type: 'RESET_BUNDLE_FILE'; fileName: BundleFileName }
  | { type: 'SET_VALIDATION_RESULT'; result: ValidationResult }
  | { type: 'UPDATE_VALIDATION_STEP'; step: ValidationStep }
  | { type: 'APPEND_SIMULATION_LOG'; entry: SimulationLogEntry }
  | { type: 'CLEAR_SIMULATION' }
  | { type: 'SET_SIMULATION_RUNNING'; running: boolean }
  | { type: 'ADD_VIRTUAL_FILE'; node: FileTreeNode }
  // Code Studio
  | { type: 'ADD_PROJECT_FILE';    file: ProjectFile }
  | { type: 'UPDATE_FILE_STREAM';  path: string; chunk: string }
  | { type: 'FINISH_FILE_STREAM';  path: string }
  | { type: 'SET_SELECTED_FILE';   path: string | null }
  | { type: 'ADD_VERSION';         version: CodeVersion }
  | { type: 'ADD_AGENT_MESSAGE';   message: AgentMessage }
  | { type: 'SET_MILESTONE';       milestone: MilestoneState | null }
  | { type: 'SET_CODEGEN_RUNNING'; running: boolean }
  | { type: 'RESET_CODE_STUDIO' }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'CLEAR_ERROR' };

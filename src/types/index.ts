// ICADP 3.0 – Core Type Definitions

export type Stage = 'stufe1' | 'stufe1_5' | 'stufe2' | 'stufe3';
export type Stufe1Step = 'idea' | 'features' | 'generating';
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'generating' | 'error';
export type BackendType = 'webgpu' | 'mlc-server' | 'llama-node' | 'ollama';

export interface BackendConfig {
  type: BackendType;
  serverUrl: string;
  modelId: string;
}

export interface FeatureProposal {
  id: string;
  title: string;
  rationale: string;
  accepted: boolean;
  techHint?: string;
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
  | { type: 'SET_ERROR'; message: string }
  | { type: 'CLEAR_ERROR' };

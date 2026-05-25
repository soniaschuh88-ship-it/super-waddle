/** src/context/AppContext.tsx – Global state via React context + useReducer. */
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { AppAction, AppState, BackendConfig, BundleFileName, GeneratedBundle } from '@/types';

export const DEFAULT_BACKEND: BackendConfig = { type: 'webgpu', serverUrl: 'http://localhost:11434', modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC' };

const initialState: AppState = {
  stage: 'stufe1', stufe1Step: 'idea',
  project: null, editableBundle: null, modifiedFiles: new Set<BundleFileName>(),
  backendConfig: DEFAULT_BACKEND,
  engineStatus: 'idle', engineProgress: { progress: 0, text: '' },
  generatingFileName: null, streamBuffer: '',
  validationResult: null,
  simulationLogs: [], simulationRunning: false, simulationVirtualTree: [],
  globalError: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_STAGE':            return { ...state, stage: action.stage };
    case 'SET_STUFE1_STEP':      return { ...state, stufe1Step: action.step };
    case 'SET_PROJECT':          return { ...state, project: action.project };
    case 'CLEAR_PROJECT':        return { ...initialState, engineStatus: state.engineStatus, engineProgress: state.engineProgress };
    case 'SET_FEATURES':         return state.project ? { ...state, project: { ...state.project, proposed_features: action.features } } : state;
    case 'TOGGLE_FEATURE':       return state.project ? { ...state, project: { ...state.project, proposed_features: state.project.proposed_features.map(f=>f.id===action.id?{...f,accepted:!f.accepted}:f) } } : state;
    case 'SET_BACKEND':          return { ...state, backendConfig: action.config };
    case 'SET_ENGINE_STATUS':    return { ...state, engineStatus: action.status };
    case 'SET_ENGINE_PROGRESS':  return { ...state, engineProgress: action.progress };
    case 'SET_GENERATING_FILE':  return { ...state, generatingFileName: action.fileName, streamBuffer: '' };
    case 'APPEND_STREAM':        return { ...state, streamBuffer: state.streamBuffer + action.chunk };
    case 'CLEAR_STREAM':         return { ...state, streamBuffer: '', generatingFileName: null };
    case 'SET_BUNDLE': {
      if (!state.project) return state;
      return { ...state, project: { ...state.project, generated_bundle: action.bundle }, editableBundle: { ...action.bundle }, modifiedFiles: new Set<BundleFileName>() };
    }
    case 'UPDATE_BUNDLE_FILE': {
      if (!state.editableBundle) return state;
      const nb: GeneratedBundle = { ...state.editableBundle, [action.fileName]: action.content };
      const nm = new Set(state.modifiedFiles); nm.add(action.fileName);
      return { ...state, editableBundle: nb, modifiedFiles: nm };
    }
    case 'RESET_BUNDLE_FILE': {
      if (!state.editableBundle||!state.project?.generated_bundle) return state;
      const original = state.project.generated_bundle[action.fileName];
      const nb: GeneratedBundle = { ...state.editableBundle, [action.fileName]: original };
      const nm = new Set(state.modifiedFiles); nm.delete(action.fileName);
      return { ...state, editableBundle: nb, modifiedFiles: nm };
    }
    case 'SET_VALIDATION_RESULT':  return { ...state, validationResult: action.result };
    case 'UPDATE_VALIDATION_STEP': return state.validationResult ? { ...state, validationResult: { ...state.validationResult, steps: state.validationResult.steps.map(s=>s.id===action.step.id?action.step:s), passed: state.validationResult.steps.map(s=>s.id===action.step.id?action.step:s).every(s=>s.status!=='fail') } } : state;
    case 'APPEND_SIMULATION_LOG':  return { ...state, simulationLogs: [...state.simulationLogs, action.entry] };
    case 'CLEAR_SIMULATION':       return { ...state, simulationLogs:[], simulationRunning:false, simulationVirtualTree:[] };
    case 'SET_SIMULATION_RUNNING': return { ...state, simulationRunning: action.running };
    case 'ADD_VIRTUAL_FILE':       return { ...state, simulationVirtualTree: [...state.simulationVirtualTree, action.node] };
    case 'SET_ERROR':   return { ...state, globalError: action.message };
    case 'CLEAR_ERROR': return { ...state, globalError: null };
    default: return state;
  }
}

interface AppContextValue { state: AppState; dispatch: Dispatch<AppAction>; }
const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppState(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be inside <AppProvider>');
  return ctx;
}

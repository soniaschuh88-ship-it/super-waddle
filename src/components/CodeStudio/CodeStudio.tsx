/**
 * src/components/CodeStudio/CodeStudio.tsx
 *
 * Main Code Studio — replaces the old fake "ExecutorSimulation".
 *
 * Layout:
 *   ┌── header: title, controls, version selector ────────────────────────────┐
 *   ├── CodeFileTree (left) │ MonacoPane (center) │ AgentChat (right) ─────────┤
 *   └─────────────────────────────────────────────────────────────────────────┘
 *   ┌── MilestoneDialog (fullscreen overlay when paused) ─────────────────────┐
 *
 * The LLM generates real source code file-by-file, streamed into Monaco.
 * At milestone checkpoints, the dialog asks the user for feedback before
 * the agent continues.
 */

import { useRef, useCallback } from 'react';
import {
  Play, Square, RotateCcw, Terminal, GitBranch, Download,
} from 'lucide-react';
import { CodeFileTree }    from './CodeFileTree';
import { MonacoPane }      from './MonacoPane';
import { AgentChat }       from './AgentChat';
import { MilestoneDialog } from './MilestoneDialog';
import { useAppState }     from '@/context/AppContext';
import {
  startCodegen,
  type CodegenHandle,
  type CodegenCallbacks,
} from '@/lib/codegen';
import { downloadBundleZip } from '@/lib/zip';
import type {
  ProjectFile,
  CodeVersion,
  AgentMessage,
  MilestoneState,
  ManifestEntry,
} from '@/types';

// ── Helper ────────────────────────────────────────────────────────────────────

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

// ── Main component ─────────────────────────────────────────────────────────────

export function CodeStudio() {
  const { state, dispatch } = useAppState();
  const {
    editableBundle,
    projectFiles,
    versions,
    codegenRunning,
    milestone,
    backendConfig,
  } = state;

  const codegenRef = useRef<CodegenHandle | null>(null);

  // ── Codegen callbacks ──────────────────────────────────────────────────────

  const callbacks: CodegenCallbacks = {
    onFileStart: (entry: ManifestEntry, idx: number, total: number) => {
      agentSay(`Writing file ${idx + 1}/${total}: \`${entry.path}\` (${entry.role})`);
    },

    onFileChunk: (path: string, chunk: string) => {
      dispatch({ type: 'UPDATE_FILE_STREAM', path, chunk });
    },

    onFileComplete: (file: ProjectFile) => {
      // codegen.ts calls onFileComplete twice per file:
      //   1st call: isStreaming=true, content='' → ADD the file
      //   2nd call: isStreaming=false, content=full → mark FINISH
      if (file.isStreaming) {
        dispatch({ type: 'ADD_PROJECT_FILE', file });
      } else {
        dispatch({ type: 'FINISH_FILE_STREAM', path: file.path });
      }
    },

    onMilestone: (
      phase: number,
      label: string,
      filesWritten: ManifestEntry[],
      suggestions: string[],
    ) => {
      // Save a version snapshot
      const version: CodeVersion = {
        idx:        versions.length + 1,
        label:      `v${versions.length + 1} — ${label}`,
        timestamp:  new Date().toISOString(),
        files:      [...state.projectFiles],
        filesCount: state.projectFiles.length,
      };
      dispatch({ type: 'ADD_VERSION', version });
      agentSay(`🏁 ${label} — saved version ${version.idx}. Pausing for your review.`);

      // We use filesWritten.length as a proxy for total (actual total is set in the dialog)
      const ms: MilestoneState = {
        phase,
        label,
        filesWritten: filesWritten.length,
        totalFiles:   filesWritten.length, // updated by dialog via projectFiles.length
        suggestedFeatures: suggestions,
      };
      dispatch({ type: 'SET_MILESTONE', milestone: ms });
    },

    onComplete: () => {
      dispatch({ type: 'SET_CODEGEN_RUNNING', running: false });
      agentSay('✅ Project complete! All files have been generated. You can now download the project as a ZIP.');
    },

    onError: (error: string) => {
      dispatch({ type: 'SET_CODEGEN_RUNNING', running: false });
      dispatch({ type: 'SET_ERROR', message: error });
    },
  };

  // ── Agent chat helper ──────────────────────────────────────────────────────

  const agentSay = useCallback((content: string) => {
    const msg: AgentMessage = { id: uid(), role: 'agent', content, timestamp: new Date().toISOString() };
    dispatch({ type: 'ADD_AGENT_MESSAGE', message: msg });
  }, [dispatch]);

  // ── Controls ───────────────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    if (!editableBundle) return;
    dispatch({ type: 'RESET_CODE_STUDIO' });
    dispatch({ type: 'SET_CODEGEN_RUNNING', running: true });
    agentSay('🚀 Starting code generation. I will write each project file and show you the code as it is written.');
    codegenRef.current = startCodegen(editableBundle, backendConfig, callbacks);
  }, [editableBundle, backendConfig, dispatch, agentSay]);

  const handleStop = useCallback(() => {
    codegenRef.current?.abort();
    dispatch({ type: 'SET_CODEGEN_RUNNING', running: false });
    agentSay('⏹ Generation stopped by user.');
  }, [dispatch, agentSay]);

  const handleReset = useCallback(() => {
    codegenRef.current?.abort();
    dispatch({ type: 'RESET_CODE_STUDIO' });
  }, [dispatch]);

  const handleMilestoneContinue = useCallback((notes: string) => {
    dispatch({ type: 'SET_MILESTONE', milestone: null });
    if (notes.trim()) agentSay(`Got it. I'll incorporate your feedback: "${notes.trim()}"`);
    else agentSay('Continuing code generation…');
    codegenRef.current?.resume(notes);
  }, [dispatch, agentSay]);

  const handleUserMessage = useCallback((msg: string) => {
    const userMsg: AgentMessage = { id: uid(), role: 'user', content: msg, timestamp: new Date().toISOString() };
    dispatch({ type: 'ADD_AGENT_MESSAGE', message: userMsg });
    // If at milestone, treat as milestone response
    if (milestone) {
      handleMilestoneContinue(msg);
    } else {
      agentSay('Noted! I\'ll factor that in as I continue generating the remaining files.');
    }
  }, [dispatch, milestone, handleMilestoneContinue, agentSay]);

  // ── Download project ZIP ───────────────────────────────────────────────────

  const handleDownload = useCallback(async () => {
    if (!projectFiles.length) return;
    const bundle: Record<string, string> = {};
    for (const f of projectFiles) bundle[f.path] = f.content;
    // Use the planning bundle files + generated code
    const fullBundle = { ...editableBundle, ...bundle };
    await downloadBundleZip(fullBundle as Parameters<typeof downloadBundleZip>[0]);
  }, [projectFiles, editableBundle]);

  if (!editableBundle) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <p className="text-muted text-sm">Complete the planning stages first.</p>
      </div>
    );
  }

  const doneCount = projectFiles.filter(f => !f.isStreaming).length;

  return (
    <div className="flex flex-col h-full relative">
      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-border bg-panel">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-accent/15 border border-accent/30">
          <Terminal size={15} className="text-accent"/>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-text-primary tracking-tight">Code Studio</h2>
          <p className="text-[11px] text-muted">
            {codegenRunning
              ? `Generating… ${doneCount} files written`
              : projectFiles.length > 0
              ? `${doneCount} files generated`
              : 'AI writes real project code file by file'}
          </p>
        </div>

        {/* Version pills */}
        {versions.length > 0 && (
          <div className="flex items-center gap-1 ml-2">
            <GitBranch size={12} className="text-muted"/>
            <span className="text-[11px] text-muted font-mono">{versions.length} snapshot{versions.length !== 1 ? 's' : ''}</span>
          </div>
        )}

        <div className="flex-1"/>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {projectFiles.length > 0 && !codegenRunning && (
            <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-accent border border-border hover:border-accent/40 rounded-lg transition-colors">
              <Download size={12}/>Download ZIP
            </button>
          )}

          {codegenRunning ? (
            <button onClick={handleStop} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-error/15 border border-error/30 text-red-400 hover:bg-error/20 rounded-lg transition-colors">
              <Square size={12}/>Stop
            </button>
          ) : projectFiles.length > 0 ? (
            <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-text-primary border border-border hover:border-border/80 rounded-lg transition-colors">
              <RotateCcw size={12}/>Reset
            </button>
          ) : null}

          {!codegenRunning && (
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-accent text-base hover:bg-accent-dim btn-glow rounded-lg transition-colors cursor-pointer"
            >
              <Play size={12}/>
              {projectFiles.length > 0 ? 'Restart Generation' : 'Start Code Generation'}
            </button>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <CodeFileTree/>
        <MonacoPane/>
        <AgentChat onUserMessage={handleUserMessage}/>
      </div>

      {/* ── Milestone dialog overlay ── */}
      {milestone && !codegenRunning && (
        <MilestoneDialog milestone={milestone} onContinue={handleMilestoneContinue}/>
      )}
    </div>
  );
}

/**
 * src/components/CodeStudio/CodeFileTree.tsx
 * Left sidebar: file tree of all generated project files.
 */
import { FileText, FileJson, FileCode, Folder, CheckCircle, Loader2 } from 'lucide-react';
import type { ProjectFile } from '@/types';
import { useAppState } from '@/context/AppContext';

function fileIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'json') return <FileJson size={13} className="text-yellow-500/70 flex-shrink-0"/>;
  if (['ts','tsx','js','jsx'].includes(ext)) return <FileCode size={13} className="text-blue-400/70 flex-shrink-0"/>;
  if (['py','go','rs','java'].includes(ext)) return <FileCode size={13} className="text-green-400/70 flex-shrink-0"/>;
  return <FileText size={13} className="text-muted/60 flex-shrink-0"/>;
}

/** Group files by top-level directory. */
function groupByDir(files: ProjectFile[]): Map<string, ProjectFile[]> {
  const map = new Map<string, ProjectFile[]>();
  for (const f of files) {
    const parts = f.path.split('/');
    const dir = parts.length > 1 ? parts[0] : '(root)';
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir)!.push(f);
  }
  return map;
}

export function CodeFileTree() {
  const { state, dispatch } = useAppState();
  const { projectFiles, selectedFilePath, codegenRunning } = state;
  const groups = groupByDir(projectFiles);

  return (
    <aside className="flex flex-col w-56 flex-shrink-0 border-r border-border bg-panel overflow-y-auto">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Project Files</p>
        {codegenRunning && <Loader2 size={11} className="text-accent animate-spin"/>}
      </div>

      {projectFiles.length === 0 ? (
        <div className="px-3 py-4 text-[11px] text-muted/40 italic">
          Files will appear here as they are generated…
        </div>
      ) : (
        <nav className="flex flex-col py-1">
          {Array.from(groups.entries()).map(([dir, files]) => (
            <div key={dir}>
              {/* Directory header */}
              <div className="flex items-center gap-1.5 px-3 py-1 mt-1">
                <Folder size={12} className="text-accent/50"/>
                <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wider">{dir}/</span>
              </div>
              {/* Files in directory */}
              {files.map(f => {
                const isSelected = f.path === selectedFilePath;
                return (
                  <button
                    key={f.path}
                    onClick={() => dispatch({ type:'SET_SELECTED_FILE', path: f.path })}
                    className={[
                      'flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors border-l-2',
                      isSelected
                        ? 'bg-accent/10 border-accent text-text-primary'
                        : 'border-transparent text-muted hover:bg-surface hover:text-text-primary',
                    ].join(' ')}
                  >
                    <span className="pl-2 flex-shrink-0">{fileIcon(f.path)}</span>
                    <span className="text-[11px] font-mono truncate flex-1">
                      {f.path.split('/').pop()}
                    </span>
                    {f.isStreaming
                      ? <Loader2 size={10} className="text-accent animate-spin flex-shrink-0"/>
                      : <CheckCircle size={10} className="text-success/60 flex-shrink-0"/>
                    }
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      )}

      {/* Stats footer */}
      {projectFiles.length > 0 && (
        <div className="mt-auto px-3 py-2 border-t border-border text-[10px] text-muted/40 font-mono">
          {projectFiles.filter(f => !f.isStreaming).length} / {projectFiles.length} files
        </div>
      )}
    </aside>
  );
}

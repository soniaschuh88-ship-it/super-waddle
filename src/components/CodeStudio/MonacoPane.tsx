/**
 * src/components/CodeStudio/MonacoPane.tsx
 * Monaco editor showing the selected (or currently streaming) file.
 */
import Editor from '@monaco-editor/react';
import { Loader2, FileCode } from 'lucide-react';
import { useAppState } from '@/context/AppContext';

export function MonacoPane() {
  const { state } = useAppState();
  const { projectFiles, selectedFilePath } = state;

  const file = selectedFilePath
    ? projectFiles.find(f => f.path === selectedFilePath)
    : projectFiles.find(f => f.isStreaming) ?? projectFiles[projectFiles.length - 1];

  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted/40">
        <FileCode size={40} strokeWidth={1}/>
        <p className="text-sm">Generated files will appear here</p>
        <p className="text-xs">Start code generation to see files being written in real-time</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 bg-panel border-b border-border">
        <span className="text-xs font-mono text-text-primary">{file.path}</span>
        {file.isStreaming && (
          <span className="flex items-center gap-1 text-[11px] text-accent animate-pulse">
            <Loader2 size={11} className="animate-spin"/>writing…
          </span>
        )}
        <div className="flex-1"/>
        <span className="text-[10px] text-muted/50 font-mono">{file.language}</span>
        <span className="text-[10px] text-muted/50 font-mono">
          {file.content.split('\n').length} lines
        </span>
      </div>

      {/* Monaco editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={file.language}
          value={file.content}
          theme="vs-dark"
          options={{
            readOnly:           !file.isStreaming ? false : true,
            minimap:            { enabled: false },
            fontSize:           13,
            fontFamily:         'JetBrains Mono, ui-monospace, monospace',
            lineNumbers:        'on',
            scrollBeyondLastLine: false,
            wordWrap:           'on',
            automaticLayout:    true,
            renderWhitespace:   'none',
            folding:            true,
            tabSize:            2,
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
            },
          }}
          loading={
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="text-muted animate-spin"/>
            </div>
          }
        />
      </div>
    </div>
  );
}

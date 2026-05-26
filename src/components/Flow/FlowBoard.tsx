/**
 * src/components/Flow/FlowBoard.tsx
 *
 * bKG Flow — AI-powered Task & Workflow Board
 * Full implementation: DnD, SSE live updates, column stats, search, projects.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Search, ChevronDown, Loader2, Zap,
  FolderOpen, BarChart2, GitBranch, AlertTriangle,
  RefreshCw, GripVertical,
} from 'lucide-react';
import { FlowTask } from './FlowTask';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FlowTask {
  id:            string;
  project_id:    string;
  mission_id:    string | null;
  milestone_id:  string | null;
  title:         string;
  description:   string;
  status:        'planning' | 'todo' | 'in-progress' | 'review' | 'done' | 'archived';
  priority:      number;
  order_index:   number;
  branch:        string;
  prompt_md:     string;
  agent_session: string;
  labels:        string[];
  dependencyIds: string[];
  created_at:    number;
  updated_at:    number;
  started_at:    number | null;
  done_at:       number | null;
}

interface Project  { id: string; name: string; description: string; color: string }
interface Column   { id: string; label: string; color: string; tasks: FlowTask[]; todayCount?: number }
interface BoardData { projectId: string; columns: Column[]; totals: Record<string, number> }

const COL_COLORS: Record<string, string> = {
  planning:     '#a855f7',
  todo:         '#6b8ca8',
  'in-progress': '#00e5ff',
  review:       '#ffb300',
  done:         '#00e5a0',
};

// ── DnD state (module-level to share between card + column) ───────────────────

let _dragTaskId = '';

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task, onClick, onQuickMove, onDragStart, isDragging,
}: {
  task:        FlowTask;
  onClick:     () => void;
  onQuickMove: (status: string) => void;
  onDragStart: () => void;
  isDragging:  boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const col     = COL_COLORS[task.status] ?? '#4a6880';
  const daysOld = Math.floor((Date.now() - task.created_at) / 86400000);
  const isStale = task.status === 'in-progress' && daysOld > 3;

  const STATUS_OPTIONS = [
    { id: 'planning',    label: 'Planning',     color: '#a855f7' },
    { id: 'todo',        label: 'Todo',         color: '#6b8ca8' },
    { id: 'in-progress', label: 'In Progress',  color: '#00e5ff' },
    { id: 'review',      label: 'Review',       color: '#ffb300' },
    { id: 'done',        label: 'Done',         color: '#00e5a0' },
  ];

  return (
    <div
      draggable
      onDragStart={(e) => {
        _dragTaskId  = task.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        onDragStart();
      }}
      onDragEnd={() => { _dragTaskId = ''; }}
      className="relative group rounded-xl border cursor-grab active:cursor-grabbing transition-all duration-150 overflow-hidden"
      style={{
        background:  isDragging ? 'rgba(0,229,255,0.04)' : 'rgba(9,22,40,0.8)',
        borderColor: isDragging ? `${col}60` : `${col}18`,
        opacity:     isDragging ? 0.5 : 1,
        transform:   isDragging ? 'scale(0.97)' : undefined,
        boxShadow:   isDragging ? `0 0 12px ${col}20` : 'none',
      }}
      onMouseEnter={e => { if (!isDragging) e.currentTarget.style.borderColor = `${col}40`; }}
      onMouseLeave={e => { if (!isDragging) e.currentTarget.style.borderColor = `${col}18`; }}
    >
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l" style={{ background: col }}/>

      {/* Drag handle */}
      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-30 text-muted transition-opacity">
        <GripVertical size={12}/>
      </div>

      {/* Card body */}
      <div className="px-3 pt-2.5 pb-2.5 pl-5" onClick={onClick}>
        <p className="text-sm font-semibold text-text-primary leading-snug mb-1.5 pr-4 truncate">{task.title}</p>

        {task.description && (
          <p className="text-[11px] text-muted/50 leading-relaxed line-clamp-2 mb-2">
            {task.description.slice(0, 90)}{task.description.length > 90 ? '…' : ''}
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {task.labels?.slice(0, 2).map(l => (
            <span key={l} className="text-[9px] px-1.5 py-0.5 rounded border font-medium"
              style={{ background: `${col}10`, borderColor: `${col}25`, color: col + 'cc' }}>
              {l}
            </span>
          ))}
          {(task.dependencyIds?.length ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted/50">
              <GitBranch size={8}/>{task.dependencyIds.length}
            </span>
          )}
          {isStale     && <AlertTriangle size={10} className="text-amber/60"/>}
          {task.priority > 70 && <div className="w-1.5 h-1.5 rounded-full bg-error/60"/>}
          {task.prompt_md    && <Zap size={9} className="text-accent/50"/>}
          {task.agent_session && <div className="w-1.5 h-1.5 rounded-full bg-mystic/70 animate-pulse"/>}
        </div>
      </div>

      {/* Quick-move */}
      <div className="absolute top-2 right-2">
        <button
          onClick={e => { e.stopPropagation(); setShowMenu(p => !p); }}
          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-muted/40 hover:text-accent hover:bg-accent/8 transition-all"
        >
          <ChevronDown size={11}/>
        </button>
        {showMenu && (
          <div className="absolute right-0 top-6 z-30 rounded-xl border p-1 min-w-32"
            style={{ background: 'rgba(9,22,40,0.98)', borderColor: 'rgba(0,229,255,0.15)' }}
            onMouseLeave={() => setShowMenu(false)}>
            {STATUS_OPTIONS.filter(s => s.id !== task.status).map(s => (
              <button key={s.id} onClick={e => { e.stopPropagation(); onQuickMove(s.id); setShowMenu(false); }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-white/4 transition-all">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }}/>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Drop indicator ─────────────────────────────────────────────────────────────

function DropIndicator({ color }: { color: string }) {
  return (
    <div className="h-0.5 rounded-full mx-1 transition-all"
      style={{ background: `${color}80`, boxShadow: `0 0 6px ${color}` }}/>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

function BoardColumn({
  col, onTaskClick, onQuickMove, onDrop,
}: {
  col:         Column;
  onTaskClick: (t: FlowTask) => void;
  onQuickMove: (taskId: string, status: string) => void;
  onDrop:      (taskId: string, toStatus: string, toIndex: number) => void;
}) {
  const [dragOver,      setDragOver]      = useState(false);
  const [dropIndex,     setDropIndex]     = useState<number | null>(null);
  const [draggingLocal, setDraggingLocal] = useState<string | null>(null);
  const colRef = useRef<HTMLDivElement>(null);

  const computeDropIndex = (clientY: number): number => {
    if (!colRef.current) return col.tasks.length;
    const cards = Array.from(colRef.current.querySelectorAll('[data-taskcard]'));
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return cards.length;
  };

  return (
    <div
      className="flex flex-col rounded-2xl flex-shrink-0 transition-all duration-150"
      style={{
        minWidth: '220px', width: '240px',
        background:  dragOver ? `rgba(6,15,30,0.8)` : 'rgba(6,15,30,0.6)',
        border:      `1px solid ${dragOver ? col.color + '40' : col.color + '15'}`,
        boxShadow:   dragOver ? `0 0 16px ${col.color}15` : undefined,
      }}
      onDragOver={e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOver(true);
        setDropIndex(computeDropIndex(e.clientY));
      }}
      onDragLeave={() => { setDragOver(false); setDropIndex(null); }}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        const idx = computeDropIndex(e.clientY);
        setDropIndex(null);
        if (_dragTaskId) onDrop(_dragTaskId, col.id, idx);
      }}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b"
        style={{ borderColor: `${col.color}15` }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: col.color }}/>
          <span className="text-xs font-bold text-text-primary uppercase tracking-wider">{col.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {(col.todayCount ?? 0) > 0 && (
            <span className="text-[9px] font-mono rounded px-1 py-0.5"
              style={{ background: `${col.color}15`, color: col.color }}>
              +{col.todayCount} today
            </span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
            style={{ background: `${col.color}15`, color: col.color }}>
            {col.tasks.length}
          </span>
        </div>
      </div>

      {/* Tasks + drop indicators */}
      <div ref={colRef} className="flex-1 overflow-y-auto px-2.5 py-2 flex flex-col gap-1.5 min-h-[80px]">
        {col.tasks.length === 0 && !dragOver && (
          <div className="flex items-center justify-center py-8 text-[11px] text-muted/25 italic">
            Drop tasks here
          </div>
        )}

        {col.tasks.map((t, i) => (
          <div key={t.id} data-taskcard="">
            {dragOver && dropIndex === i && <DropIndicator color={col.color}/>}
            <TaskCard
              task={t}
              onClick={() => onTaskClick(t)}
              onQuickMove={status => onQuickMove(t.id, status)}
              onDragStart={() => setDraggingLocal(t.id)}
              isDragging={draggingLocal === t.id}
            />
          </div>
        ))}
        {dragOver && dropIndex === col.tasks.length && <DropIndicator color={col.color}/>}
      </div>
    </div>
  );
}

// ── Main FlowBoard ────────────────────────────────────────────────────────────

export function FlowBoard() {
  const [board,         setBoard]         = useState<BoardData | null>(null);
  const [projects,      setProjects]      = useState<Project[]>([]);
  const [projectId,     setProjectId]     = useState('default');
  const [loading,       setLoading]       = useState(true);
  const [query,         setQuery]         = useState('');
  const [searchResults, setSearchResults] = useState<FlowTask[] | null>(null);
  const [searchBusy,    setSearchBusy]    = useState(false);
  const [activeTask,    setActiveTask]    = useState<FlowTask | null>(null);
  const [creating,      setCreating]      = useState(false);
  const [newTitle,      setNewTitle]      = useState('');
  const [newDesc,       setNewDesc]       = useState('');
  const [newStatus,     setNewStatus]     = useState<FlowTask['status']>('todo');
  const [submitting,    setSubmitting]    = useState(false);
  const [showProject,   setShowProject]   = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load board ──────────────────────────────────────────────────────────────

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      // Load board + today stats in parallel
      const [boardRes, statsRes] = await Promise.all([
        fetch(`/flow/board/${projectId}`),
        fetch(`/flow/stats?projectId=${projectId}&since=${Date.now() - 86400000}`),
      ]);
      if (boardRes.ok) {
        const bd = await boardRes.json() as BoardData;
        // Merge today counts if available
        if (statsRes.ok) {
          const stats = await statsRes.json() as Record<string, number>;
          bd.columns = bd.columns.map(col => ({ ...col, todayCount: stats[col.id] ?? 0 }));
        }
        setBoard(bd);
      }
    } catch { /**/ }
    setLoading(false);
  }, [projectId]);

  const loadProjects = useCallback(async () => {
    const r = await fetch('/flow/projects').then(r => r.json()).catch(() => []);
    setProjects(r as Project[]);
  }, []);

  useEffect(() => { void loadBoard(); void loadProjects(); }, [loadBoard, loadProjects]);

  // ── SSE real-time ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchResults !== null) return;
    const es = new EventSource(`/flow/events?projectId=${projectId}`);

    const merge = (task: FlowTask, type: string) => {
      setBoard(prev => {
        if (!prev) return prev;
        const taskId = (task as { id: string }).id;
        if (type === 'task.deleted') {
          return { ...prev, columns: prev.columns.map(col => ({ ...col, tasks: col.tasks.filter(t => t.id !== taskId) })) };
        }
        const filtered = prev.columns.map(col => ({ ...col, tasks: col.tasks.filter(t => t.id !== taskId) }));
        return {
          ...prev,
          columns: filtered.map(col => col.id === task.status
            ? { ...col, tasks: [...col.tasks, task].sort((a, b) => a.order_index - b.order_index) }
            : col,
          ),
        };
      });
    };

    es.addEventListener('task.created', e => merge(JSON.parse(e.data).task, 'task.created'));
    es.addEventListener('task.updated', e => merge(JSON.parse(e.data).task, 'task.updated'));
    es.addEventListener('task.deleted', e => merge(JSON.parse(e.data).task, 'task.deleted'));
    es.addEventListener('board.reload', () => void loadBoard());
    return () => es.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, searchResults]);

  // ── Search ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) { setSearchResults(null); return; }
    setSearchBusy(true);
    searchTimer.current = setTimeout(async () => {
      const r = await fetch(`/flow/tasks/search?projectId=${projectId}&q=${encodeURIComponent(query)}`)
        .then(r => r.json()).catch(() => []);
      setSearchResults(r as FlowTask[]);
      setSearchBusy(false);
    }, 300);
  }, [query, projectId]);

  // ── E10: Keyboard shortcuts ─────────────────────────────────────────────────
  // N → open new task form   /  → focus search   Esc → close panel / clear search

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing inside any input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        // Esc still works inside inputs
        if (e.key === 'Escape') {
          setCreating(false);
          setNewTitle('');
          setNewDesc('');
          setQuery('');
          (e.target as HTMLElement).blur();
        }
        return;
      }

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          setCreating(true);
          break;

        case '/':
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          break;

        case 'Escape':
          if (creating) { setCreating(false); setNewTitle(''); setNewDesc(''); }
          if (query)    setQuery('');
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, query]);

  const createTask = async () => {
    if (!newTitle.trim()) return;
    setSubmitting(true);
    await fetch('/flow/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim(), description: newDesc, status: newStatus, projectId }),
    });
    setNewTitle(''); setNewDesc(''); setCreating(false);
    setSubmitting(false);
    // SSE will handle the board update; also reload for safety
    void loadBoard();
  };

  // ── E2: Drag-and-drop ──────────────────────────────────────────────────────

  const handleDrop = async (taskId: string, toStatus: string, toIndex: number) => {
    // Optimistic update
    setBoard(prev => {
      if (!prev) return prev;
      let draggedTask: FlowTask | undefined;
      const stripped = prev.columns.map(col => ({
        ...col,
        tasks: col.tasks.filter(t => { if (t.id === taskId) { draggedTask = t; return false; } return true; }),
      }));
      if (!draggedTask) return prev;
      const updated   = { ...draggedTask, status: toStatus as FlowTask['status'], order_index: toIndex };
      return {
        ...prev,
        columns: stripped.map(col => col.id === toStatus
          ? {
              ...col,
              tasks: [
                ...col.tasks.slice(0, toIndex),
                updated,
                ...col.tasks.slice(toIndex),
              ].map((t, i) => ({ ...t, order_index: i })),
            }
          : col,
        ),
      };
    });

    // Persist
    await fetch(`/flow/tasks/${taskId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: toStatus, index: toIndex }),
    });
  };

  // ── Quick-move ─────────────────────────────────────────────────────────────

  const quickMove = async (taskId: string, status: string) => {
    await fetch(`/flow/tasks/${taskId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    // SSE handles update; reload for safety
    void loadBoard();
  };

  const handleTaskUpdate = (updated: FlowTask) => {
    setActiveTask(updated);
    void loadBoard();
  };

  const cur = projects.find(p => p.id === projectId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#030810' }}>

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-3 border-b"
        style={{ background: 'rgba(6,15,30,0.9)', backdropFilter: 'blur(12px)', borderColor: 'rgba(0,229,255,0.06)' }}>

        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center border"
            style={{ background: 'rgba(0,229,255,0.08)', borderColor: 'rgba(0,229,255,0.2)' }}>
            <Zap size={15} className="text-accent"/>
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif",letterSpacing:'0.04em' }}>bKG Flow</p>
            <p className="text-[9px] text-muted/40 font-mono tracking-widest uppercase">Task Board</p>
          </div>
        </div>

        {/* Project selector */}
        <div className="relative">
          <button onClick={() => setShowProject(p => !p)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all"
            style={{ background: `${cur?.color ?? '#00e5ff'}10`, borderColor: `${cur?.color ?? '#00e5ff'}25`, color: cur?.color ?? '#00e5ff' }}>
            <FolderOpen size={11}/>{cur?.name ?? 'Default'}
            <ChevronDown size={10}/>
          </button>
          {showProject && (
            <div className="absolute top-9 left-0 z-30 rounded-xl border p-1 min-w-48"
              style={{ background: 'rgba(9,22,40,0.98)', borderColor: 'rgba(0,229,255,0.15)' }}>
              {projects.map(p => (
                <button key={p.id} onClick={() => { setProjectId(p.id); setShowProject(false); }}
                  className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs text-left transition-all ${p.id === projectId ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                  <div className="w-2 h-2 rounded-full" style={{ background: p.color }}/>
                  <span className="font-semibold text-text-primary">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 max-w-64 bg-base/70 border border-border/50 rounded-xl px-2.5 py-1.5 focus-within:border-accent/40 transition-colors">
          {searchBusy ? <Loader2 size={12} className="text-muted/50 animate-spin flex-shrink-0"/>
            : <Search size={12} className="text-muted/50 flex-shrink-0"/>}
          <input ref={searchInputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search tasks…  (/)"
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-muted/30 focus:outline-none"/>
          {query && <button onClick={() => setQuery('')} className="text-muted/30 hover:text-muted text-xs">✕</button>}
        </div>

        {/* Stats */}
        {board && (
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-muted/50">
            <BarChart2 size={12} className="text-accent/40"/>
            <span>{(board.totals['in-progress'] ?? 0)} active</span>
            <span>·</span>
            <span>{(board.totals['done'] ?? 0)} done</span>
          </div>
        )}

        <button onClick={loadBoard} disabled={loading}
          className="text-muted/40 hover:text-accent transition-colors flex-shrink-0">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/>
        </button>

        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-base bg-accent btn-glow hover:brightness-110 transition-all cursor-pointer flex-shrink-0">
          <Plus size={12}/>
          <span className="hidden sm:inline">New Task</span>
        </button>
      </div>

      {/* Create Task */}
      {creating && (
        <div className="flex-shrink-0 px-4 py-3 border-b"
          style={{ background: 'rgba(9,22,40,0.8)', borderColor: 'rgba(0,229,255,0.1)', borderTop: '1px solid rgba(0,229,255,0.06)' }}>
          <div className="flex flex-col gap-2 max-w-xl">
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && void createTask()}
              placeholder="Task title…"
              className="bg-base/80 border border-accent/30 text-text-primary text-sm font-semibold rounded-xl px-3 py-2.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
              autoFocus/>
            <div className="flex gap-2">
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="flex-1 bg-base/80 border border-border text-text-primary text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-accent/40 placeholder:text-muted/30"/>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value as FlowTask['status'])}
                className="bg-base/80 border border-border text-text-primary text-xs rounded-xl px-2 py-2 focus:outline-none">
                {['planning','todo','in-progress','review'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={createTask} disabled={!newTitle.trim() || submitting}
                className="px-3 py-2 rounded-xl text-xs font-bold text-base bg-accent btn-glow hover:brightness-110 transition-all cursor-pointer disabled:opacity-50">
                {submitting ? <Loader2 size={12} className="animate-spin"/> : 'Add'}
              </button>
              <button onClick={() => { setCreating(false); setNewTitle(''); setNewDesc(''); }}
                className="px-3 py-2 rounded-xl text-xs text-muted border border-border hover:border-accent/30 hover:text-text-primary transition-all">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Board */}
      {loading && !board ? (
        <div className="flex items-center justify-center flex-1 gap-2 text-muted/40 text-sm">
          <Loader2 size={16} className="animate-spin"/>Loading board…
        </div>
      ) : searchResults !== null ? (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Search size={13} className="text-muted/50"/>
            <p className="text-xs text-muted/60">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{query}"</p>
          </div>
          <div className="flex flex-col gap-2 max-w-lg">
            {searchResults.map(t => (
              <TaskCard key={t.id} task={t}
                onClick={() => setActiveTask(t)}
                onQuickMove={s => void quickMove(t.id, s)}
                onDragStart={() => {}}
                isDragging={false}
              />
            ))}
          </div>
        </div>
      ) : board ? (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 px-4 py-4 h-full" style={{ minWidth: `${board.columns.length * 260}px` }}>
            {board.columns.map(col => (
              <BoardColumn
                key={col.id}
                col={col}
                onTaskClick={setActiveTask}
                onQuickMove={(tid, s) => void quickMove(tid, s)}
                onDrop={(tid, toStatus, toIdx) => void handleDrop(tid, toStatus, toIdx)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <Zap size={48} strokeWidth={1} className="text-muted/20"/>
          <p className="text-sm text-muted/40">Could not load board</p>
        </div>
      )}

      {/* Task detail modal */}
      {activeTask && (
        <FlowTask
          task={activeTask}
          onClose={() => { setActiveTask(null); void loadBoard(); }}
          onUpdate={handleTaskUpdate}
        />
      )}
    </div>
  );
}

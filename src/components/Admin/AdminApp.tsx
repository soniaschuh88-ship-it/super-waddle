/**
 * src/components/Admin/AdminApp.tsx
 *
 * Admin dashboard — Atlantis Cyberpunk design.
 * Responsive: sidebar on desktop, bottom nav on mobile.
 * Mode-aware: highlights Cloud/Private-specific tabs.
 */
import { useState, useEffect } from 'react';
import {
  Cpu, BarChart2, HardDrive, Settings, LogOut,
  Server, Box, Power, FlaskConical, Download,
  Bot, Puzzle, Key, Globe, Lock, Cloud, Menu, X,
} from 'lucide-react';
import { AdminAuth, logout, verifyStoredToken, getToken } from './AdminAuth';
import { OllamaManager }       from './OllamaManager';
import { NodeLlamaCppManager } from './NodeLlamaCppManager';
import { ServerManager }       from './ServerManager';
import { WebLLMCache }         from './WebLLMCache';
import { SystemStats }         from './SystemStats';
import { AISettings }          from './AISettings';
import { EmbeddingsLab }       from './EmbeddingsLab';
import { ModelDownloadPanel }  from './ModelDownloadPanel';
import { AgentSettings }       from './AgentSettings';
import { PluginManager }       from './PluginManager';
import { ApiKeys }             from './ApiKeys';
import { GlobalProviders }     from './GlobalProviders';
import { useAppState }         from '@/context/AppContext';

type Tab = 'agent' | 'apikeys' | 'globals' | 'plugins' | 'servers' | 'models' |
           'embeddings' | 'stats' | 'ollama' | 'llamacpp' | 'webllm' | 'settings';

interface TabDef {
  id:      Tab;
  label:   string;
  icon:    React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>;
  mode?:   'private' | 'cloud';   // highlighted in this mode
  section: 'cloud' | 'local' | 'general';
}

const TABS: TabDef[] = [
  // Cloud-relevant
  { id:'globals',    label:'Global Providers',  icon:Globe,       mode:'cloud',   section:'cloud'   },
  { id:'apikeys',    label:'API Keys',           icon:Key,                         section:'cloud'   },
  // General
  { id:'agent',      label:'Agent Settings',    icon:Bot,                          section:'general' },
  { id:'plugins',    label:'Plugins',           icon:Puzzle,                       section:'general' },
  { id:'stats',      label:'System Stats',      icon:BarChart2,                    section:'general' },
  { id:'settings',   label:'AI Settings',       icon:Settings,                     section:'general' },
  // Private/local
  { id:'servers',    label:'Server Manager',    icon:Power,       mode:'private', section:'local'   },
  { id:'models',     label:'Download Models',   icon:Download,    mode:'private', section:'local'   },
  { id:'ollama',     label:'Ollama Manager',    icon:Server,      mode:'private', section:'local'   },
  { id:'llamacpp',   label:'node-llama-cpp',    icon:Box,         mode:'private', section:'local'   },
  { id:'webllm',     label:'WebLLM Cache',      icon:HardDrive,   mode:'private', section:'local'   },
  { id:'embeddings', label:'Embeddings Lab',    icon:FlaskConical,                 section:'local'   },
];

const SECTION_LABELS = {
  cloud:   { icon: Cloud,  label: 'Cloud',   color: '#00e5ff' },
  local:   { icon: Lock,   label: 'Private', color: '#ffb300' },
  general: { icon: Settings, label: 'General', color: '#4a6880' },
};

// ── Sidebar nav item ──────────────────────────────────────────────────────────

function NavItem({
  tab, active, mode, onClick,
}: {
  tab:     TabDef;
  active:  boolean;
  mode:    'private' | 'cloud';
  onClick: () => void;
}) {
  const Icon      = tab.icon;
  const highlighted = tab.mode === mode;
  const accentColor = highlighted
    ? (mode === 'cloud' ? '#00e5ff' : '#ffb300')
    : undefined;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-150 rounded-xl mx-2 text-sm"
      style={{
        background: active
          ? `rgba(${highlighted ? (mode === 'cloud' ? '0,229,255' : '255,179,0') : '0,229,255'},0.1)`
          : 'transparent',
        color: active
          ? (accentColor ?? '#00e5ff')
          : highlighted
          ? (accentColor + '90')
          : '#4a6880',
        borderLeft: active ? `2px solid ${accentColor ?? '#00e5ff'}` : '2px solid transparent',
        paddingLeft: active ? '10px' : '12px',
      }}
    >
      <Icon size={14} style={{ color: active ? (accentColor ?? '#00e5ff') : highlighted ? (accentColor + '70') : '#4a6880' }}/>
      <span className="font-medium">{tab.label}</span>
      {highlighted && !active && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full"
          style={{ background: accentColor }}/>
      )}
    </button>
  );
}

// ── Main AdminApp ─────────────────────────────────────────────────────────────

export function AdminApp() {
  const { state }  = useAppState();
  const mode       = (localStorage.getItem('bkg_mode') as 'private' | 'cloud') ?? 'private';

  const [unlocked, setUnlocked] = useState(() => !!getToken());
  const [tab, setTab]   = useState<Tab>(() =>
    mode === 'cloud' ? 'globals' : 'servers',
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Verify token with server on mount
  useEffect(() => {
    if (getToken()) {
      verifyStoredToken().then(valid => { if (!valid) setUnlocked(false); });
    }
  }, []);

  const handleUnlock = () => setUnlocked(true);
  const handleLock   = () => { logout(); setUnlocked(false); };

  if (!unlocked) return <AdminAuth onUnlock={handleUnlock}/>;

  const activeTab = TABS.find(t => t.id === tab)!;
  const isCloud   = mode === 'cloud';

  const sections: Array<{ key: keyof typeof SECTION_LABELS; tabs: TabDef[] }> = [
    { key: 'cloud',   tabs: TABS.filter(t => t.section === 'cloud') },
    { key: 'local',   tabs: TABS.filter(t => t.section === 'local') },
    { key: 'general', tabs: TABS.filter(t => t.section === 'general') },
  ];

  const Sidebar = (
    <aside
      className="flex flex-col h-full overflow-y-auto py-3"
      style={{ width: '208px', minWidth: '208px' }}
    >
      {sections.map(({ key, tabs }) => {
        const sec = SECTION_LABELS[key];
        const SecIcon = sec.icon;
        return (
          <div key={key} className="mb-2">
            <div className="flex items-center gap-1.5 px-5 py-1.5">
              <SecIcon size={9} style={{ color: sec.color }}/>
              <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: sec.color + '80' }}>
                {sec.label}
              </span>
            </div>
            {tabs.map(t => (
              <NavItem
                key={t.id}
                tab={t}
                active={tab === t.id}
                mode={mode}
                onClick={() => { setTab(t.id); setSidebarOpen(false); }}
              />
            ))}
          </div>
        );
      })}
    </aside>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#030810' }}>
      {/* ── Header ── */}
      <header
        className="flex-shrink-0 h-14 flex items-center justify-between px-4 sm:px-6 border-b z-20 relative"
        style={{
          background: 'rgba(6,15,30,0.9)',
          backdropFilter: 'blur(12px)',
          borderColor: 'rgba(0,229,255,0.08)',
          boxShadow: '0 1px 0 rgba(0,229,255,0.05)',
        }}
      >
        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(p => !p)}
          className="flex md:hidden text-muted hover:text-accent transition-colors mr-2"
        >
          {sidebarOpen ? <X size={18}/> : <Menu size={18}/>}
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center border"
            style={{ background: 'rgba(0,229,255,0.08)', borderColor: 'rgba(0,229,255,0.2)' }}
          >
            <Cpu size={16} className="text-accent"/>
          </div>
          <div>
            <span
              className="text-sm font-bold tracking-wider"
              style={{
                fontFamily: "'Orbitron', sans-serif",
                background: 'linear-gradient(135deg, #00e5ff, #a855f7)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              bKG
            </span>
            <span className="ml-2 text-[9px] text-muted/50 font-mono tracking-widest uppercase">Admin</span>
          </div>
        </div>

        {/* Mode indicator */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold"
          style={{
            background: isCloud ? 'rgba(0,229,255,0.06)' : 'rgba(255,179,0,0.06)',
            borderColor: isCloud ? 'rgba(0,229,255,0.2)' : 'rgba(255,179,0,0.2)',
            color: isCloud ? '#00e5ff' : '#ffb300',
          }}
        >
          {isCloud ? <Cloud size={10}/> : <Lock size={10}/>}
          {isCloud ? 'Cloud Mode' : 'Private Mode'}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <a
            href="/"
            className="text-xs text-muted hover:text-accent px-2.5 py-1.5 rounded-lg hover:bg-accent/6 transition-all"
          >
            ← App
          </a>
          <button
            onClick={handleLock}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-error px-2.5 py-1.5 rounded-lg hover:bg-error/8 transition-all"
          >
            <LogOut size={12}/>Lock
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Desktop sidebar */}
        <div
          className="hidden md:block flex-shrink-0 border-r"
          style={{
            borderColor: 'rgba(0,229,255,0.06)',
            background: 'rgba(9,22,40,0.5)',
          }}
        >
          {Sidebar}
        </div>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-30 bg-base/80 backdrop-blur-sm md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <div
              className="fixed left-0 top-14 bottom-0 z-40 md:hidden border-r overflow-y-auto"
              style={{
                width: '220px',
                background: 'rgba(9,22,40,0.98)',
                borderColor: 'rgba(0,229,255,0.1)',
                boxShadow: '4px 0 30px rgba(0,229,255,0.05)',
              }}
            >
              {Sidebar}
            </div>
          </>
        )}

        {/* Content */}
        <main className="flex-1 overflow-auto p-4 sm:p-8">
          <div className="max-w-3xl">
            {/* Section heading */}
            <div className="flex items-center gap-3 mb-6 pb-4 border-b" style={{ borderColor: 'rgba(0,229,255,0.06)' }}>
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center border"
                style={{
                  background: activeTab.mode === 'cloud' ? 'rgba(0,229,255,0.1)'
                    : activeTab.mode === 'private' ? 'rgba(255,179,0,0.1)'
                    : 'rgba(0,229,255,0.06)',
                  borderColor: activeTab.mode === 'cloud' ? 'rgba(0,229,255,0.25)'
                    : activeTab.mode === 'private' ? 'rgba(255,179,0,0.25)'
                    : 'rgba(0,229,255,0.1)',
                }}
              >
                <activeTab.icon
                  size={16}
                  style={{
                    color: activeTab.mode === 'cloud' ? '#00e5ff'
                      : activeTab.mode === 'private' ? '#ffb300'
                      : '#4a6880',
                  }}
                />
              </div>
              <div>
                <h2
                  className="text-base font-bold"
                  style={{
                    fontFamily: "'Orbitron', sans-serif",
                    color: activeTab.mode === 'cloud' ? '#00e5ff'
                      : activeTab.mode === 'private' ? '#ffb300'
                      : '#e8f4f8',
                    letterSpacing: '0.04em',
                  }}
                >
                  {activeTab.label}
                </h2>
                <p className="text-[11px] text-muted/50 mt-0.5 font-mono">
                  {activeTab.section === 'cloud' ? 'Cloud Mode' : activeTab.section === 'local' ? 'Private Mode' : 'General'}
                </p>
              </div>
            </div>

            {/* Tab content */}
            {tab === 'agent'      && <AgentSettings/>}
            {tab === 'apikeys'    && <ApiKeys/>}
            {tab === 'globals'    && <GlobalProviders/>}
            {tab === 'plugins'    && <PluginManager/>}
            {tab === 'servers'    && <ServerManager/>}
            {tab === 'models'     && (
              <ModelDownloadPanel
                serverUrl={state.backendConfig.type === 'llama-cpp'
                  ? state.backendConfig.serverUrl
                  : 'http://localhost:8001'}
              />
            )}
            {tab === 'embeddings' && <EmbeddingsLab backendConfig={state.backendConfig}/>}
            {tab === 'stats'      && <SystemStats/>}
            {tab === 'ollama'     && <OllamaManager/>}
            {tab === 'llamacpp'   && <NodeLlamaCppManager/>}
            {tab === 'webllm'     && <WebLLMCache/>}
            {tab === 'settings'   && <AISettings/>}
          </div>
        </main>
      </div>

      {/* Bottom glow accent */}
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 left-0 right-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(168,85,247,0.4), rgba(0,229,255,0.3), transparent)' }}
      />
    </div>
  );
}

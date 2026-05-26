/**
 * src/components/Admin/AdminApp.tsx
 * Top-level admin dashboard — password gate + tabbed sections.
 */
import { useState, useEffect } from 'react';
import { Cpu, BarChart2, HardDrive, Settings, LogOut, Server, Box, Power, FlaskConical, Download, Bot, Puzzle, Key, Globe } from 'lucide-react';
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

type Tab = 'agent' | 'apikeys' | 'globals' | 'plugins' | 'servers' | 'models' | 'embeddings' | 'stats' | 'ollama' | 'llamacpp' | 'webllm' | 'settings';

const TABS: { id: Tab; label: string; icon: React.FC<{size?:number;className?:string}> }[] = [
  { id:'agent',      label:'Agent Settings',    icon:Bot          },
  { id:'apikeys',    label:'API Keys',           icon:Key          },
  { id:'globals',    label:'Global Providers',  icon:Globe        },
  { id:'plugins',    label:'Plugins',           icon:Puzzle       },
  { id:'servers',    label:'Server Manager',    icon:Power        },
  { id:'models',     label:'Download Models',   icon:Download     },
  { id:'embeddings', label:'Embeddings Lab',    icon:FlaskConical },
  { id:'stats',      label:'System Stats',      icon:BarChart2    },
  { id:'ollama',     label:'Ollama Manager',    icon:Server       },
  { id:'llamacpp',   label:'node-llama-cpp',    icon:Box          },
  { id:'webllm',     label:'WebLLM Cache',      icon:HardDrive    },
  { id:'settings',   label:'AI Settings',       icon:Settings     },
];

export function AdminApp() {
  const { state } = useAppState();
  const [unlocked, setUnlocked] = useState(() => !!getToken());
  const [tab, setTab]           = useState<Tab>('servers');

  // Verify token with server on mount
  useEffect(() => {
    if (getToken()) {
      verifyStoredToken().then(valid => { if (!valid) setUnlocked(false); });
    }
  }, []);

  const handleUnlock = () => setUnlocked(true);
  const handleLock   = () => { logout(); setUnlocked(false); };

  if (!unlocked) return <AdminAuth onUnlock={handleUnlock}/>;

  const ActiveTab = TABS.find(t => t.id === tab)!;

  return (
    <div className="min-h-screen bg-base text-text-primary flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 h-14 flex items-center justify-between px-6 border-b border-border glass">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/15 border border-accent/30">
            <Cpu size={18} className="text-accent"/>
          </div>
          <div>
            <span className="text-sm font-semibold text-text-primary tracking-tight">bKG Admin</span>
            <span className="ml-2 text-[10px] text-accent font-mono tracking-widest">v3.0</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-xs text-muted hover:text-text-primary px-2 py-1 rounded hover:bg-surface transition-colors">← App</a>
          <button onClick={handleLock} className="flex items-center gap-1.5 text-xs text-muted hover:text-error px-2 py-1 rounded hover:bg-surface transition-colors">
            <LogOut size={13}/>Lock
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-52 flex-shrink-0 border-r border-border bg-panel flex flex-col py-3">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={[
                  'flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-l-2 text-sm',
                  t.id === tab
                    ? 'bg-accent/10 border-accent text-accent font-medium'
                    : 'border-transparent text-muted hover:bg-surface hover:text-text-primary',
                ].join(' ')}>
                <Icon size={15}/>{t.label}
              </button>
            );
          })}
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-auto p-8">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-6">
              <ActiveTab.icon size={18} className="text-accent"/>
              <h2 className="text-lg font-semibold text-text-primary">{ActiveTab.label}</h2>
            </div>
            {tab === 'agent'      && <AgentSettings/>}
            {tab === 'apikeys'    && <ApiKeys/>}
            {tab === 'globals'    && <GlobalProviders/>}
            {tab === 'plugins'    && <PluginManager/>}
            {tab === 'servers'    && <ServerManager/>}
            {tab === 'models'     && (
              <ModelDownloadPanel
                serverUrl={state.backendConfig.type === 'llama-cpp' ? state.backendConfig.serverUrl : 'http://localhost:8001'}
              />
            )}
            {tab === 'embeddings' && (
              <EmbeddingsLab backendConfig={state.backendConfig}/>
            )}
            {tab === 'stats'      && <SystemStats/>}
            {tab === 'ollama'     && <OllamaManager/>}
            {tab === 'llamacpp'   && <NodeLlamaCppManager/>}
            {tab === 'webllm'     && <WebLLMCache/>}
            {tab === 'settings'   && <AISettings/>}
          </div>
        </main>
      </div>
    </div>
  );
}

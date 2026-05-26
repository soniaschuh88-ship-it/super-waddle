import { useState, useEffect }  from 'react';
import { AppShell }              from '@/components/Layout/AppShell';
import { Dashboard }             from '@/components/UserDashboard/Dashboard';
import { ModelTester }           from '@/components/UserDashboard/ModelTester';
import { UserSettings }          from '@/components/UserDashboard/UserSettings';
import { Onboarding }            from '@/components/UserDashboard/Onboarding';
import { WizardModal }           from '@/components/Stufe1/WizardModal';
import { ValidationLoop }        from '@/components/Stufe1_5/ValidationLoop';
import { DualPaneExplorer }      from '@/components/Stufe2/DualPaneExplorer';
import { CodeStudio }            from '@/components/CodeStudio/CodeStudio';
import { AgentHub }              from '@/components/AgentHub/AgentHub';
import { FlowBoard }             from '@/components/Flow/FlowBoard';
import { GameWizard }            from '@/components/Game/GameWizard';
import { VoxelEngine }           from '@/components/Voxel/VoxelEngine';
import { MMOEngine }             from '@/components/MMO/MMOEngine';
import { useAppState }           from '@/context/AppContext';

type HomeView = 'dashboard' | 'tester' | 'settings';

function StageView() {
  const { state }               = useAppState();
  const [homeView, setHomeView] = useState<HomeView>('dashboard');

  switch (state.stage) {
    case 'home':
      if (homeView === 'tester')   return <ModelTester/>;
      if (homeView === 'settings') return <UserSettings onClose={() => setHomeView('dashboard')}/>;
      return (
        <Dashboard
          onTestModel={() => setHomeView('tester')}
          onOpenSettings={() => setHomeView('settings')}
        />
      );
    case 'stufe1':    return <WizardModal/>;
    case 'stufe1_5':  return <ValidationLoop/>;
    case 'stufe2':    return <DualPaneExplorer/>;
    case 'stufe3':    return <CodeStudio/>;
    case 'agenthub':  return <AgentHub/>;
    case 'flow':      return <FlowBoard/>;
    case 'game':      return <GameWizard/>;
    case 'voxel':     return <VoxelEngine/>;
    case 'mmo':       return <MMOEngine/>;
    default:          return (
      <Dashboard
        onTestModel={() => setHomeView('tester')}
        onOpenSettings={() => setHomeView('settings')}
      />
    );
  }
}

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('bkg_user_api_key');
  });

  useEffect(() => {
    const handler = () => setShowOnboarding(true);
    window.addEventListener('bkg:show-onboarding', handler);
    return () => window.removeEventListener('bkg:show-onboarding', handler);
  }, []);

  return (
    <AppShell>
      <StageView/>
      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)}/>
      )}
    </AppShell>
  );
}

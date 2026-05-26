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
import { useAppState }           from '@/context/AppContext';

type HomeView = 'dashboard' | 'tester' | 'settings';

function StageView() {
  const { state }               = useAppState();
  const [homeView, setHomeView] = useState<HomeView>('dashboard');

  // Reset home sub-view when leaving the home stage
  const prev = state.stage;
  if (prev !== 'home' && homeView !== 'dashboard') {
    /* will re-render on next visit */
  }

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
    default:          return (
      <Dashboard
        onTestModel={() => setHomeView('tester')}
        onOpenSettings={() => setHomeView('settings')}
      />
    );
  }
}

export default function App() {
  // Show onboarding overlay if user hasn't set up their API key yet
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('bkg_user_api_key');
  });

  // Also listen for a manual "show onboarding" event from Dashboard
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

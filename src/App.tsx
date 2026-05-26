import { useState }            from 'react';
import { AppShell }            from '@/components/Layout/AppShell';
import { Dashboard }           from '@/components/UserDashboard/Dashboard';
import { ModelTester }         from '@/components/UserDashboard/ModelTester';
import { WizardModal }         from '@/components/Stufe1/WizardModal';
import { ValidationLoop }      from '@/components/Stufe1_5/ValidationLoop';
import { DualPaneExplorer }    from '@/components/Stufe2/DualPaneExplorer';
import { CodeStudio }          from '@/components/CodeStudio/CodeStudio';
import { AgentHub }            from '@/components/AgentHub/AgentHub';
import { useAppState }         from '@/context/AppContext';

function StageView() {
  const { state } = useAppState();
  const [homeView, setHomeView] = useState<'dashboard' | 'tester'>('dashboard');

  switch (state.stage) {
    case 'home':
      return homeView === 'tester'
        ? <ModelTester/>
        : <Dashboard onTestModel={() => setHomeView('tester')}/>;
    case 'stufe1':    return <WizardModal/>;
    case 'stufe1_5':  return <ValidationLoop/>;
    case 'stufe2':    return <DualPaneExplorer/>;
    case 'stufe3':    return <CodeStudio/>;
    case 'agenthub':  return <AgentHub/>;
    default:          return <Dashboard onTestModel={() => setHomeView('tester')}/>;
  }
}

export default function App() {
  return <AppShell><StageView /></AppShell>;
}

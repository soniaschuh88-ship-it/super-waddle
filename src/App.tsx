import { AppShell } from '@/components/Layout/AppShell';
import { WizardModal } from '@/components/Stufe1/WizardModal';
import { ValidationLoop } from '@/components/Stufe1_5/ValidationLoop';
import { DualPaneExplorer } from '@/components/Stufe2/DualPaneExplorer';
import { ExecutorSimulation } from '@/components/Stufe3/ExecutorSimulation';
import { useAppState } from '@/context/AppContext';

function StageView() {
  const { state } = useAppState();
  switch (state.stage) {
    case 'stufe1':   return <WizardModal />;
    case 'stufe1_5': return <ValidationLoop />;
    case 'stufe2':   return <DualPaneExplorer />;
    case 'stufe3':   return <ExecutorSimulation />;
    default:         return <WizardModal />;
  }
}

export default function App() {
  return <AppShell><StageView /></AppShell>;
}

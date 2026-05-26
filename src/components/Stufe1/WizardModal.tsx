/** src/components/Stufe1/WizardModal.tsx – Multi-step wizard for Stufe 1. */
import { useState, useCallback } from 'react';
import { Layers } from 'lucide-react';
import { IdeaInput } from './IdeaInput';
import { FeatureTable } from './FeatureTable';
import { GenerationProgress } from './GenerationProgress';
import { BackendSelector } from './BackendSelector';
import { useAppState } from '@/context/AppContext';
import { loadClient, generateJson, generateStreaming } from '@/lib/llm-client';
import { FEATURE_SYSTEM_PROMPT, buildFeatureUserPrompt, AGENT_MD_SYSTEM, buildAgentMdUserPrompt, ARCHITECTURE_MD_SYSTEM, buildArchitectureMdUserPrompt, ROADMAP_MD_SYSTEM, buildRoadmapMdUserPrompt, TASKS_MD_SYSTEM, buildTasksMdUserPrompt, MANIFEST_SYSTEM, buildManifestUserPrompt } from '@/lib/prompts';
import { buildInitialValidationResult, runValidationStep } from '@/lib/validation';
import { createProject, updateProject, generateId, recordGeneration } from '@/lib/db';
import type { FeatureProposal, GeneratedBundle, BundleFileName, ValidationCheckId } from '@/types';

const STEP_LABELS = { idea:'1. Describe Idea', features:'2. Select Features', generating:'3. Generate Plan' };

type DocStep = { fileName:BundleFileName; buildPrompts:(i:string,f:FeatureProposal[])=>{system:string;user:string}; maxTokens:number; };
const DOC_STEPS: DocStep[] = [
  { fileName:'agent.md',        buildPrompts:(i,f)=>({system:AGENT_MD_SYSTEM,        user:buildAgentMdUserPrompt(i,f)}),        maxTokens:4096 },
  { fileName:'architecture.md', buildPrompts:(i,f)=>({system:ARCHITECTURE_MD_SYSTEM, user:buildArchitectureMdUserPrompt(i,f)}), maxTokens:3000 },
  { fileName:'roadmap.md',      buildPrompts:(i,f)=>({system:ROADMAP_MD_SYSTEM,       user:buildRoadmapMdUserPrompt(i,f)}),       maxTokens:2500 },
  { fileName:'tasks.md',        buildPrompts:(i,f)=>({system:TASKS_MD_SYSTEM,         user:buildTasksMdUserPrompt(i,f)}),         maxTokens:3500 },
  { fileName:'manifest.json',   buildPrompts:(i,f)=>({system:MANIFEST_SYSTEM,         user:buildManifestUserPrompt(i,f)}),        maxTokens:2000 },
];

export function WizardModal() {
  const { state, dispatch } = useAppState();
  const [ideaText, setIdeaText] = useState('');
  const { stufe1Step: step, backendConfig, project } = state;
  const features = project?.proposed_features ?? [];
  const isLoading = state.engineStatus==='loading'||state.engineStatus==='generating';

  const handleProposeFeatures = useCallback(async () => {
    dispatch({type:'CLEAR_ERROR'});
    try {
      dispatch({type:'SET_ENGINE_STATUS',status:'loading'});
      dispatch({type:'SET_STUFE1_STEP',step:'features'});
      await loadClient(backendConfig, p=>dispatch({type:'SET_ENGINE_PROGRESS',progress:p}));
      dispatch({type:'SET_ENGINE_STATUS',status:'ready'});
      const now=new Date().toISOString(); const id=generateId();
      dispatch({type:'SET_ENGINE_STATUS',status:'generating'});
      const raw = await generateJson<FeatureProposal[]>(FEATURE_SYSTEM_PROMPT, buildFeatureUserPrompt(ideaText), backendConfig);
      const features: FeatureProposal[] = raw ?? [
        { id:'core', title:'Core Functionality', rationale:'The essential feature described.', accepted:true, priority:'high', complexity:'M' },
      ];
      const p = { id, idea_text:ideaText, proposed_features:features, generated_bundle:null, validation_results:null, created_at:now, updated_at:now };
      await createProject(p);
      dispatch({type:'SET_PROJECT',project:p});
      dispatch({type:'SET_ENGINE_STATUS',status:'ready'});
    } catch (err) {
      dispatch({type:'SET_ENGINE_STATUS',status:'error'});
      dispatch({type:'SET_ERROR',message:err instanceof Error?err.message:'Failed to load model or reach server.'});
      dispatch({type:'SET_STUFE1_STEP',step:'idea'});
    }
  }, [ideaText, backendConfig, dispatch]);

  const handleGeneratePlan = useCallback(async () => {
    if (!project) return;
    dispatch({type:'CLEAR_ERROR'});
    const accepted = project.proposed_features.filter(f=>f.accepted);
    dispatch({type:'SET_STUFE1_STEP',step:'generating'});
    dispatch({type:'SET_ENGINE_STATUS',status:'generating'});
    try {
      const bundle: Partial<GeneratedBundle> = {};
      for (const step of DOC_STEPS) {
        dispatch({type:'SET_GENERATING_FILE',fileName:step.fileName});
        const { system, user } = step.buildPrompts(project.idea_text, accepted);
        const content = await generateStreaming(system, user, c=>dispatch({type:'APPEND_STREAM',chunk:c}), step.maxTokens, backendConfig);
        bundle[step.fileName] = content;
        const partial = { ...project, generated_bundle:{...bundle} as GeneratedBundle, updated_at:new Date().toISOString() };
        await updateProject(partial);
        dispatch({type:'SET_PROJECT',project:partial});
      }
      dispatch({type:'CLEAR_STREAM'}); dispatch({type:'SET_ENGINE_STATUS',status:'ready'});
      await recordGeneration(backendConfig.type, backendConfig.modelId);
      const finalBundle = bundle as GeneratedBundle;
      dispatch({type:'SET_BUNDLE',bundle:finalBundle});
      const init = buildInitialValidationResult();
      dispatch({type:'SET_VALIDATION_RESULT',result:init});
      const ORDER: ValidationCheckId[] = ['redundancy','overkill','task-operability','dependency','mvp-scope'];
      let allPassed=true;
      for (const id of ORDER) {
        await new Promise<void>(r=>setTimeout(r,500));
        dispatch({type:'UPDATE_VALIDATION_STEP',step:{...init.steps.find(s=>s.id===id)!,status:'running'}});
        await new Promise<void>(r=>setTimeout(r,800));
        const res = runValidationStep(id, finalBundle);
        dispatch({type:'UPDATE_VALIDATION_STEP',step:res});
        if (res.status==='fail') allPassed=false;
      }
      await new Promise<void>(r=>setTimeout(r,1000));
      dispatch({type:'SET_VALIDATION_RESULT',result:{steps:init.steps,passed:allPassed,completedAt:new Date().toISOString()}});
      dispatch({type:'SET_STAGE',stage:'stufe1_5'});
    } catch (err) {
      dispatch({type:'SET_ENGINE_STATUS',status:'error'}); dispatch({type:'CLEAR_STREAM'});
      dispatch({type:'SET_ERROR',message:err instanceof Error?err.message:'Generation failed.'});
    }
  }, [project, backendConfig, dispatch]);

  return (
    <div className="flex items-start justify-center min-h-full px-4 py-8">
      <div className="w-full max-w-2xl flex flex-col gap-3">
        {step==='idea' && <BackendSelector/>}
        <div className="rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-panel">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-accent/15 border border-accent/30"><Layers size={15} className="text-accent"/></div>
            <div><h1 className="text-sm font-semibold text-text-primary tracking-tight">ICADP Factory Plan Generator</h1><p className="text-[11px] text-muted">{STEP_LABELS[step]}</p></div>
            <div className="ml-auto flex items-center gap-1.5">
              {(['idea','features','generating'] as const).map(s=><div key={s} className={['w-2 h-2 rounded-full transition-colors',s===step?'bg-accent':'bg-border'].join(' ')}/>)}
            </div>
          </div>
          <div className="p-6">
            {step==='idea' && (
              <IdeaInput
                value={ideaText}
                onChange={setIdeaText}
                onSubmit={handleProposeFeatures}
                isLoading={isLoading}
                loadProgress={
                  state.engineStatus === 'loading'
                    ? state.engineProgress.progress
                    : isLoading ? -1 : undefined
                }
                loadText={
                  state.engineStatus === 'loading'
                    ? state.engineProgress.text || `Loading model… ${state.engineProgress.progress}%`
                    : isLoading
                    ? backendConfig.type === 'webgpu' ? 'Initialising engine…' : `Connecting to ${backendConfig.type}…`
                    : undefined
                }
              />
            )}
            {step==='features' && (
              isLoading&&features.length===0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin"/>
                  <p className="text-sm text-muted">{state.engineStatus==='loading'?backendConfig.type==='webgpu'?`Loading model… ${state.engineProgress.progress}%`:`Connecting to ${backendConfig.type}…`:'Generating proposals…'}</p>
                  {state.engineStatus==='loading'&&backendConfig.type==='webgpu'&&<div className="w-48 h-1 rounded-full bg-border overflow-hidden"><div className="h-full bg-accent rounded-full transition-all" style={{width:`${state.engineProgress.progress}%`}}/></div>}
                </div>
              ) : <FeatureTable features={features} onGenerate={handleGeneratePlan} isLoading={isLoading}/>
            )}
            {step==='generating' && <GenerationProgress/>}
          </div>
        </div>
      </div>
    </div>
  );
}

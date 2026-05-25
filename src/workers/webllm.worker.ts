/**
 * src/workers/webllm.worker.ts – Web Worker host for @mlc-ai/web-llm.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event: MessageEvent) => { handler.onmessage(event); };

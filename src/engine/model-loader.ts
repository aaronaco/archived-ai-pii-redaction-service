import { pipeline, TokenClassificationPipeline } from '@xenova/transformers';

export interface ModelSession {
  pipeline: TokenClassificationPipeline;
}

let pipelineInstance: TokenClassificationPipeline | null = null;

/**
 * Initializes ONNX token classification pipeline.
 * Caches instance for singleton access.
 */
export async function loadModel(
  modelId: string,
  options: { quantized?: boolean } = {}
): Promise<ModelSession> {
  if (pipelineInstance) {
    console.log('[WARN] Model already loaded');
    return { pipeline: pipelineInstance };
  }

  console.log(`[INFO] Loading PII detection model: ${modelId}...`);
  const quantized = options.quantized ?? true;
  console.log(`[INFO] Quantized model: ${quantized}`);
  console.log('   (First run will download and cache the model)');
  const startTime = Date.now();

  pipelineInstance = await pipeline('token-classification', modelId, {
    quantized,
  }) as TokenClassificationPipeline;

  const loadTime = Date.now() - startTime;
  console.log(`[OK] Model loaded in ${loadTime}ms`);

  return { pipeline: pipelineInstance };
}

/** Retrieves active model pipeline or throws if uninitialized. */
export function getModelPipeline(): TokenClassificationPipeline {
  if (!pipelineInstance) {
    throw new Error('Model not loaded. Call loadModel() first.');
  }
  return pipelineInstance;
}

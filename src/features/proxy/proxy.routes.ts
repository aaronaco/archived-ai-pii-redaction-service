import type { FastifyInstance } from 'fastify';
import { pipeline, env as transformersEnv, type TokenClassificationPipeline } from '@xenova/transformers';
import { handleChatCompletions, handleChatCompletionsStream } from './proxy.controller.js';
import { getModelPipeline } from '../../engine/model-loader.js';
import type { OpenAiChatCompletionRequest } from '../../shared/types/openai.types.js';

const debugPipelineCache = new Map<string, Promise<TokenClassificationPipeline>>();

async function getDebugPipeline(
  modelId: string,
  quantized?: boolean
): Promise<TokenClassificationPipeline> {
  const quantizedKey = quantized === undefined ? 'default' : quantized ? 'quantized' : 'full';
  const cacheKey = `${modelId}:${quantizedKey}`;
  const cached = debugPipelineCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const isLocalPath = modelId.startsWith('./') || modelId.startsWith('/');

  const options: Record<string, unknown> = {};
  if (quantized !== undefined) {
    options.quantized = quantized;
  }

  let resolvedModelId = modelId;
  if (isLocalPath) {
    const path = await import('node:path');
    const absolutePath = path.resolve(modelId);
    const parentDir = path.dirname(absolutePath);
    const modelName = path.basename(absolutePath);

    transformersEnv.localModelPath = parentDir + '/';
    transformersEnv.allowLocalModels = true;
    transformersEnv.allowRemoteModels = false;
    resolvedModelId = modelName;
  }

  const load = pipeline(
    'token-classification',
    resolvedModelId,
    Object.keys(options).length > 0 ? options : undefined
  ) as Promise<TokenClassificationPipeline>;
  debugPipelineCache.set(cacheKey, load);
  return load;
}

export async function registerProxyRoutes(app: FastifyInstance): Promise<void> {
  const { redactionService, sessionService } = app.deps;
  type DebugRedactBody = {
    text?: string;
    includeRaw?: boolean;
    modelId?: string;
    quantized?: boolean;
  };

  app.post<{ Body: OpenAiChatCompletionRequest }>('/v1/chat/completions', async (request, reply) => {
    const body = request.body as OpenAiChatCompletionRequest;

    if (body?.stream) {
      await handleChatCompletionsStream(request, reply, {
        redactionService,
        sessionService,
      });
      return;
    }

    await handleChatCompletions(request, reply, {
      redactionService,
      sessionService,
    });
  });

  app.post<{ Body: DebugRedactBody }>('/debug/redact', async (request, reply) => {
    const body = request.body as DebugRedactBody;
    const text = typeof body?.text === 'string' ? body.text : '';

    if (!text.trim()) {
      reply.status(400).send({
        error: 'Bad Request',
        message: 'Body must include a non-empty "text" field.',
        statusCode: 400,
      });
      return;
    }

    const redaction = await redactionService.redact(text);
    let raw: unknown | undefined;

    if (body.includeRaw) {
      const modelId = typeof body.modelId === 'string' && body.modelId.trim()
        ? body.modelId.trim()
        : undefined;
      const debugPipeline = modelId
        ? await getDebugPipeline(modelId, body.quantized)
        : getModelPipeline();
      const modelIdUsed = modelId ?? 'default';
      const rawTokens = await debugPipeline(text, { ignore_labels: [] } as Record<string, unknown>);
      const id2label = (debugPipeline as unknown as { model?: { config?: { id2label?: Record<string, string> } } })
        .model?.config?.id2label;

      raw = {
        modelId: modelIdUsed,
        quantized: body.quantized,
        tokens: rawTokens,
        id2label,
      };
    }

    reply.send({
      input: text,
      redaction,
      raw,
    });
  });

  app.get('/v1/health', async () => ({
    status: 'ok',
    service: 'pii-redaction-proxy',
    timestamp: new Date().toISOString(),
    upstreamProvider: 'openai-compatible',
  }));
}

import 'dotenv/config';
import { env } from './infrastructure/config/env.js';
import { createStoreClient } from './infrastructure/store/store-client.js';
import { createServer } from './infrastructure/http/server.js';
import { loadModel } from './engine/model-loader.js';
import { RedactionService } from './features/redaction/index.js';
import { SessionStore } from './features/session/session.store.js';
import { SessionService } from './features/session/risk-engine.service.js';
import { registerProxyRoutes } from './features/proxy/proxy.routes.js';

async function bootstrap(): Promise<void> {
  console.log('[INFO] Starting PII Redaction Middleware...\n');

  try {
    console.log('[INIT] Phase 1: Loading AI Engine\n');
    const modelSession = await loadModel(env.MODEL_ID, {
      quantized: env.MODEL_QUANTIZED,
    });

    console.log('\n[INIT] Phase 2: Connecting Infrastructure\n');
    const store = await createStoreClient();

    console.log('\n[INIT] Phase 3: Initializing Services\n');
    const redactionService = new RedactionService(modelSession, {
      useDeterministicReplacement: true,
      salt: env.SALT,
      timeoutMs: env.INFERENCE_TIMEOUT_MS,
      failStrategy: env.FAIL_STRATEGY,
    });

    const sessionStore = new SessionStore(store);
    const sessionService = new SessionService(sessionStore, {
      threshold: env.RISK_THRESHOLD,
      windowMs: env.RISK_WINDOW_MS,
    });

    console.log('[INIT] Phase 4: Starting HTTP Server\n');
    const app = await createServer({
      store,
      redactionService,
      sessionService,
    });

    await registerProxyRoutes(app);

    await app.listen({ port: env.PORT, host: env.HOST });

    console.log(`\n[OK] PII Redaction Middleware running at http://${env.HOST}:${env.PORT}`);
    console.log(`   Upstream: ${env.UPSTREAM_URL}`);
    console.log(`   Fail Strategy: ${env.FAIL_STRATEGY}`);
    console.log(`   Rate Limit: ${env.RATE_LIMIT_MAX} req/${env.RATE_LIMIT_WINDOW_MS}ms\n`);

    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      await app.close();
      await store.quit();
      console.log('[INFO] Goodbye!');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[ERROR] Failed to start:', error);
    process.exit(1);
  }
}

bootstrap();

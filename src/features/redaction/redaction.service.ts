import type { ModelSession } from '../../engine/model-loader.js';
import { runInference } from '../../engine/inference-runner.js';
import { getDeterministicReplacement, getSimpleRedaction } from './replacement.utils.js';
import type { PiiEntity, DetectionResult } from '../../shared/types/pii.types.js';

export interface RedactionOptions {
  useDeterministicReplacement: boolean;
  salt: string;
  timeoutMs: number;
  failStrategy: 'closed' | 'open';
}

export class InferenceTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Inference timeout exceeded: ${timeoutMs}ms`);
    this.name = 'InferenceTimeoutError';
  }
}

export interface RedactionResult {
  text: string;
  entities: PiiEntity[];
  processingTimeMs: number;
}

/**
 * Orchestrates PII detection and replacement with fail-safe mechanisms.
 */
export class RedactionService {
  private modelSession: ModelSession;
  private options: RedactionOptions;

  constructor(modelSession: ModelSession, options: RedactionOptions) {
    this.modelSession = modelSession;
    this.options = options;
  }

  /**
   * Identifies and replaces PII entities in text.
   * Respects configured timeout and fail strategies.
   */
  async redact(text: string): Promise<RedactionResult> {
    if (!text || text.trim().length === 0) {
      return { text, entities: [], processingTimeMs: 0 };
    }

    try {
      console.log('[DEBUG] Running PII detection on:', text);
      const detection = await this.runWithTimeout(
        runInference(this.modelSession, text),
        this.options.timeoutMs
      );
      console.log('[DEBUG] Detected entities:', JSON.stringify(detection.entities));

      if (detection.entities.length === 0) {
        console.log('[DEBUG] No entities found');
        return {
          text,
          entities: [],
          processingTimeMs: detection.processingTimeMs,
        };
      }

      const redactedText = this.applyRedactions(text, detection.entities);

      return {
        text: redactedText,
        entities: detection.entities,
        processingTimeMs: detection.processingTimeMs,
      };
    } catch (error) {
      if (error instanceof InferenceTimeoutError) {
        if (this.options.failStrategy === 'closed') {
          throw error;
        } else {
          console.warn(`[WARN] Inference timeout - passing through unredacted (fail-open mode)`);
          return { text, entities: [], processingTimeMs: this.options.timeoutMs };
        }
      }
      throw error;
    }
  }

  private async runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new InferenceTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  async detect(text: string): Promise<DetectionResult> {
    if (!text || text.trim().length === 0) {
      return { entities: [], processingTimeMs: 0 };
    }

    return runInference(this.modelSession, text);
  }

  private applyRedactions(text: string, entities: PiiEntity[]): string {
    const sortedEntities = [...entities].sort((a, b) => b.start - a.start);

    let result = text;

    for (const entity of sortedEntities) {
      const replacement = this.options.useDeterministicReplacement
        ? getDeterministicReplacement(entity.text, entity.type, this.options.salt)
        : getSimpleRedaction(entity.type);

      result = result.slice(0, entity.start) + replacement + result.slice(entity.end);
    }

    return result;
  }

  updateOptions(options: Partial<RedactionOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

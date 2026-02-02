import { Transform, TransformCallback } from 'node:stream';
import type { RedactionService } from '../redaction/index.js';
import type { OpenAiChatCompletionChunk } from '../../shared/types/openai.types.js';

export interface StreamTransformerOptions {
  maxTokens: number;
  maxDelayMs: number;
}

const DEFAULT_OPTIONS: StreamTransformerOptions = {
  maxTokens: 20,
  maxDelayMs: 200,
};

const SENTENCE_BOUNDARY = /[.!?]\s+|[.!?]$/;

/**
 * Buffers SSE chunks to ensure sentence-boundary integrity for PII detection.
 * Implements "Split-Transform-Merge" pattern.
 */
export class PiiRedactionStream extends Transform {
  private buffer = '';
  private tokenCount = 0;
  private lastFlushTime = Date.now();
  private redactionService: RedactionService;
  private options: StreamTransformerOptions;
  private flushTimer: NodeJS.Timeout | null = null;
  private lineBuffer = '';
  private lastMeta: { id?: string; model?: string; created?: number; index?: number; role?: string } = {};
  private roleEmitted = false;

  constructor(redactionService: RedactionService, options: Partial<StreamTransformerOptions> = {}) {
    super({ objectMode: false });
    this.redactionService = redactionService;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): Promise<void> {
    try {
      const chunkStr = chunk.toString('utf-8');
      this.lineBuffer += chunkStr;

      const lines = this.lineBuffer.split('\n');
      this.lineBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.startsWith('data:')) {
          if (line === '') {
            this.push('\n');
          } else {
            this.push(line + '\n');
          }
          continue;
        }

        const jsonStr = line.slice(5).trim();

        if (jsonStr === '[DONE]') {
          await this.flushBuffer();
          this.push('data: [DONE]\n\n');
          continue;
        }

        try {
          const data = JSON.parse(jsonStr) as OpenAiChatCompletionChunk;
          const content = this.extractDeltaContent(data);

          if (content) {
            this.buffer += content;
            this.tokenCount += this.estimateTokens(content);

            if (this.shouldFlush()) {
              await this.flushBuffer();
            }
          } else {
            this.push(line + '\n');
          }
        } catch {
          this.push(line + '\n');
        }
      }

      this.scheduleFlush();
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async _flush(callback: TransformCallback): Promise<void> {
    try {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
      }
      if (this.lineBuffer) {
        this.push(this.lineBuffer);
        this.lineBuffer = '';
      }
      await this.flushBuffer();
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Extracts text content from OpenAI delta chunk, tracking metadata. */
  private extractDeltaContent(data: OpenAiChatCompletionChunk): string {
    if (!data || !data.choices || data.choices.length === 0) return '';

    const choice = data.choices[0];
    if (!choice) return '';

    this.lastMeta = {
      id: data.id ?? this.lastMeta.id,
      model: data.model ?? this.lastMeta.model,
      created: data.created ?? this.lastMeta.created,
      index: choice.index ?? this.lastMeta.index,
      role: (choice.delta as { role?: string })?.role ?? this.lastMeta.role,
    };

    const delta = choice.delta as { content?: string };
    if (!delta || typeof delta.content !== 'string') return '';

    return delta.content;
  }

  /** Determines flush necessity based on boundaries, token limits, or timeouts. */
  private shouldFlush(): boolean {
    if (SENTENCE_BOUNDARY.test(this.buffer)) {
      return true;
    }

    if (this.tokenCount >= this.options.maxTokens) {
      return true;
    }

    if (Date.now() - this.lastFlushTime >= this.options.maxDelayMs) {
      return true;
    }

    return false;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    if (this.buffer.length > 0) {
      this.flushTimer = setTimeout(() => {
        this.flushBuffer().catch((err) => {
          this.emit('error', err);
        });
      }, this.options.maxDelayMs);
    }
  }

  /** Processes buffered text through redaction service and emits SSE event. */
  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const textToProcess = this.buffer;
    this.buffer = '';
    this.tokenCount = 0;
    this.lastFlushTime = Date.now();

    const result = await this.redactionService.redact(textToProcess);
    const sseData = this.formatAsOpenAiSSE(result.text);
    this.push(sseData);
  }

  private formatAsOpenAiSSE(text: string): string {
    const delta: Record<string, unknown> = { content: text };

    if (this.lastMeta.role && !this.roleEmitted) {
      delta.role = this.lastMeta.role;
      this.roleEmitted = true;
    }

    const response = {
      id: this.lastMeta.id,
      object: 'chat.completion.chunk',
      created: this.lastMeta.created,
      model: this.lastMeta.model,
      choices: [
        {
          index: this.lastMeta.index ?? 0,
          delta,
          finish_reason: null,
        },
      ],
    };

    return `data: ${JSON.stringify(response)}\n\n`;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export function createRedactionStream(
  redactionService: RedactionService,
  options?: Partial<StreamTransformerOptions>
): PiiRedactionStream {
  return new PiiRedactionStream(redactionService, options);
}

import type { FastifyRequest, FastifyReply } from 'fastify';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { createRedactionStream } from './stream.transformer.js';
import { env } from '../../infrastructure/config/env.js';
import type { RedactionService } from '../redaction/index.js';
import type { SessionService } from '../session/risk-engine.service.js';
import type {
  OpenAiChatCompletionRequest,
  OpenAiChatCompletionResponse,
  OpenAiMessage,
} from '../../shared/types/openai.types.js';
import { redactMessageContent } from '../../shared/types/openai.types.js';

export interface ProxyControllerDeps {
  redactionService: RedactionService;
  sessionService: SessionService;
}

/** Handles standard JSON-based chat completion requests. */
export async function handleChatCompletions(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ProxyControllerDeps
): Promise<void> {
  const { redactionService, sessionService } = deps;

  const sessionId = sessionService.extractSessionId(
    request.headers as Record<string, string | string[] | undefined>,
    request.ip
  );

  if (await sessionService.isBanned(sessionId)) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'Session blocked due to excessive PII exposure. Please try again later.',
    });
    return;
  }

  const body = request.body as OpenAiChatCompletionRequest;
  if (!body?.messages || !Array.isArray(body.messages)) {
    reply.status(400).send({
      error: 'Bad Request',
      message: 'Body must include "messages" array.',
    });
    return;
  }

  const redactedMessages = await redactMessages(
    body.messages,
    redactionService,
    sessionService,
    sessionId
  );

  const upstreamUrl = `${env.UPSTREAM_URL.replace(/\/$/, '')}/chat/completions`;

  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.UPSTREAM_API_KEY ? { Authorization: `Bearer ${env.UPSTREAM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      ...body,
      stream: false,
      messages: redactedMessages,
    }),
  });

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text();
    reply.status(upstreamResponse.status).send({
      error: 'Upstream Error',
      message: errorText,
    });
    return;
  }

  const responseData = (await upstreamResponse.json()) as OpenAiChatCompletionResponse;
  const redactedResponse = await redactResponse(
    responseData,
    redactionService,
    sessionService,
    sessionId
  );

  reply.send(redactedResponse);
}

/** Handles SSE streaming chat completion requests with real-time redaction. */
export async function handleChatCompletionsStream(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ProxyControllerDeps
): Promise<void> {
  const { redactionService, sessionService } = deps;

  const sessionId = sessionService.extractSessionId(
    request.headers as Record<string, string | string[] | undefined>,
    request.ip
  );

  if (await sessionService.isBanned(sessionId)) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'Session blocked due to excessive PII exposure. Please try again later.',
    });
    return;
  }

  const body = request.body as OpenAiChatCompletionRequest;
  if (!body?.messages || !Array.isArray(body.messages)) {
    reply.status(400).send({
      error: 'Bad Request',
      message: 'Body must include "messages" array.',
    });
    return;
  }

  const redactedMessages = await redactMessages(
    body.messages,
    redactionService,
    sessionService,
    sessionId
  );

  const upstreamUrl = `${env.UPSTREAM_URL.replace(/\/$/, '')}/chat/completions`;

  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.UPSTREAM_API_KEY ? { Authorization: `Bearer ${env.UPSTREAM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      ...body,
      stream: true,
      messages: redactedMessages,
    }),
  });

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text();
    reply.status(upstreamResponse.status).send({
      error: 'Upstream Error',
      message: errorText,
    });
    return;
  }

  if (!upstreamResponse.body) {
    reply.status(502).send({
      error: 'Bad Gateway',
      message: 'No response body from upstream',
    });
    return;
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const redactionStream = createRedactionStream(redactionService);
  const passthrough = new PassThrough();
  const reader = upstreamResponse.body.getReader();

  const readStream = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          passthrough.end();
          break;
        }
        passthrough.write(value);
      }
    } catch (error) {
      passthrough.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  };

  readStream();

  try {
    await pipeline(passthrough, redactionStream, reply.raw);
  } catch (error) {
    request.log.error(error, 'Stream pipeline error');
    if (!reply.raw.headersSent) {
      reply.status(500).send({
        error: 'Stream Error',
        message: 'Error processing stream',
      });
    }
  }
}

/** Redacts PII from input messages array and assesses session risk. */
async function redactMessages(
  messages: OpenAiMessage[],
  redactionService: RedactionService,
  sessionService: SessionService,
  sessionId: string
): Promise<OpenAiMessage[]> {
  const redactedMessages: OpenAiMessage[] = [];

  for (const message of messages) {
    if (message.content !== undefined) {
      const redactedContent = await redactMessageContent(message.content, async (text) => {
        const result = await redactionService.redact(text);
        if (result.entities.length > 0) {
          await sessionService.assessRisk(sessionId, result.entities);
        }
        return result.text;
      });

      redactedMessages.push({
        ...message,
        content: redactedContent,
      });
    } else {
      redactedMessages.push(message);
    }
  }

  return redactedMessages;
}

/** Redacts PII from upstream response content and assesses session risk. */
async function redactResponse(
  response: OpenAiChatCompletionResponse,
  redactionService: RedactionService,
  sessionService: SessionService,
  sessionId: string
): Promise<OpenAiChatCompletionResponse> {
  if (!response?.choices) return response;

  for (const choice of response.choices) {
    if (!choice?.message?.content) continue;

    const redactedContent = await redactMessageContent(choice.message.content, async (text) => {
      const result = await redactionService.redact(text);
      if (result.entities.length > 0) {
        await sessionService.assessRisk(sessionId, result.entities);
      }
      return result.text;
    });

    choice.message.content = redactedContent;
  }

  return response;
}

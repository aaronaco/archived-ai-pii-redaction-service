export type OpenAiRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface OpenAiTextPart {
  type: 'text';
  text: string;
}

export interface OpenAiNonTextPart {
  type: string;
  [key: string]: unknown;
}

export type OpenAiMessageContent = string | Array<OpenAiTextPart | OpenAiNonTextPart>;

export interface OpenAiMessage {
  role: OpenAiRole;
  content: OpenAiMessageContent;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAiChatCompletionRequest {
  model: string;
  messages: OpenAiMessage[];
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  [key: string]: unknown;
}

export interface OpenAiChatCompletionChoice {
  index: number;
  message: OpenAiMessage;
  finish_reason?: string | null;
}

export interface OpenAiChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: OpenAiChatCompletionChoice[];
  usage?: unknown;
  [key: string]: unknown;
}

export interface OpenAiChatCompletionChunkChoice {
  index: number;
  delta: Partial<OpenAiMessage>;
  finish_reason?: string | null;
}

export interface OpenAiChatCompletionChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: OpenAiChatCompletionChunkChoice[];
  usage?: unknown;
  [key: string]: unknown;
}

export function redactMessageContent(
  content: OpenAiMessageContent,
  redactText: (text: string) => Promise<string>
): Promise<OpenAiMessageContent> {
  if (typeof content === 'string') {
    return redactText(content);
  }

  if (Array.isArray(content)) {
    const next = content.map(async (part) => {
      if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
        const redacted = await redactText(part.text);
        return { ...part, text: redacted };
      }
      return part;
    });
    return Promise.all(next);
  }

  return Promise.resolve(content);
}

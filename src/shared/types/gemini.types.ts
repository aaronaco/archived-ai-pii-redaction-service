export interface GeminiContent {
  parts: GeminiPart[];
  role?: 'user' | 'model';
}

export interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: GeminiSafetySetting[];
  systemInstruction?: GeminiContent;
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
}

export interface GeminiSafetySetting {
  category: string;
  threshold: string;
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  index?: number;
  safetyRatings?: GeminiSafetyRating[];
}

export interface GeminiSafetyRating {
  category: string;
  probability: string;
}

export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: {
    safetyRatings?: GeminiSafetyRating[];
    blockReason?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface GeminiStreamChunk {
  candidates?: Array<{
    content: {
      parts: Array<{ text?: string }>;
      role?: string;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export function extractTextFromParts(parts: GeminiPart[]): string {
  return parts
    .filter((part) => part.text !== undefined)
    .map((part) => part.text)
    .join('');
}

export function createTextContent(text: string, role: 'user' | 'model' = 'user'): GeminiContent {
  return {
    role,
    parts: [{ text }],
  };
}

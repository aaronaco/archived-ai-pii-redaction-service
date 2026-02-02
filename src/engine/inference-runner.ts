import type { ModelSession } from './model-loader.js';
import type { PiiEntity, PiiEntityType } from '../shared/types/pii.types.js';

const LABEL_TO_PII_TYPE: Record<string, PiiEntityType> = {
  'ACCOUNTNUM': 'BANK_ACCOUNT',
  'BUILDINGNUM': 'ADDRESS',
  'CITY': 'ADDRESS',
  'CREDITCARDNUMBER': 'CREDIT_CARD',
  'DATEOFBIRTH': 'DATE_OF_BIRTH',
  'DRIVERLICENSENUM': 'DRIVER_LICENSE',
  'EMAIL': 'EMAIL',
  'GIVENNAME': 'PERSON',
  'IDCARDNUM': 'NATIONAL_ID',
  'PASSWORD': 'PASSWORD',
  'SOCIALNUM': 'SSN',
  'STREET': 'ADDRESS',
  'SURNAME': 'PERSON',
  'TAXNUM': 'TAX_ID',
  'TELEPHONENUM': 'PHONE',
  'USERNAME': 'USERNAME',
  'ZIPCODE': 'ADDRESS',
};

export interface InferenceResult {
  entities: PiiEntity[];
  processingTimeMs: number;
}

interface RawToken {
  entity: string;
  word: string;
  score: number;
  index: number;
}

export async function runInference(
  modelSession: ModelSession,
  text: string
): Promise<InferenceResult> {
  const startTime = Date.now();

  const tokens = (await modelSession.pipeline(text)) as RawToken[];
  const entities = groupAndLocateEntities(tokens, text);

  return {
    entities,
    processingTimeMs: Date.now() - startTime,
  };
}

function groupAndLocateEntities(tokens: RawToken[], text: string): PiiEntity[] {
  const entities: PiiEntity[] = [];
  const usedRanges: Array<[number, number]> = [];

  let group: { label: string; words: string[]; scores: number[]; lastIdx: number } | null = null;

  for (const token of tokens) {
    const label = parseLabel(token.entity);
    if (!label || !LABEL_TO_PII_TYPE[label]) {
      if (group) {
        const entity = finalizeGroup(group, text, usedRanges);
        if (entity) {
          entities.push(entity);
          usedRanges.push([entity.start, entity.end]);
        }
        group = null;
      }
      continue;
    }

    // Gap in token indices = separate entity
    const hasGap = group && token.index > group.lastIdx + 1;

    if (!group || group.label !== label || hasGap) {
      if (group) {
        const entity = finalizeGroup(group, text, usedRanges);
        if (entity) {
          entities.push(entity);
          usedRanges.push([entity.start, entity.end]);
        }
      }
      group = { label, words: [token.word], scores: [token.score], lastIdx: token.index };
    } else {
      group.words.push(token.word);
      group.scores.push(token.score);
      group.lastIdx = token.index;
    }
  }

  if (group) {
    const entity = finalizeGroup(group, text, usedRanges);
    if (entity) entities.push(entity);
  }

  return entities;
}

function parseLabel(entity: string): string | null {
  if (!entity || entity === 'O') return null;
  // Strip B-/I- prefix
  if (entity.startsWith('B-') || entity.startsWith('I-')) {
    return entity.slice(2);
  }
  return entity;
}

function finalizeGroup(
  group: { label: string; words: string[]; scores: number[] },
  text: string,
  usedRanges: Array<[number, number]>
): PiiEntity | null {
  const piiType = LABEL_TO_PII_TYPE[group.label];
  if (!piiType) return null;

  // Join subword tokens: handle leading spaces and ## markers
  let joined = '';
  for (const w of group.words) {
    if (w.startsWith('##')) {
      joined += w.slice(2);
    } else if (w.startsWith(' ')) {
      joined += joined ? w : w.slice(1);
    } else {
      joined += w;
    }
  }
  joined = joined.trim();
  if (joined.length < 2) return null;

  // Find in original text, avoiding used ranges
  const pos = findPosition(joined, text, usedRanges);
  if (!pos) return null;

  return {
    type: piiType,
    text: text.slice(pos[0], pos[1]),
    start: pos[0],
    end: pos[1],
    confidence: group.scores.reduce((a, b) => a + b, 0) / group.scores.length,
  };
}

function findPosition(
  search: string,
  text: string,
  usedRanges: Array<[number, number]>
): [number, number] | null {
  const lower = text.toLowerCase();
  const target = search.toLowerCase();

  let from = 0;
  while (from < text.length) {
    const start = lower.indexOf(target, from);
    if (start === -1) break;

    const end = start + search.length;
    if (!usedRanges.some(([s, e]) => start < e && end > s)) {
      return [start, end];
    }
    from = start + 1;
  }

  return null;
}

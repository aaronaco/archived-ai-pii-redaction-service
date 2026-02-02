export const PII_ENTITY_TYPES = [
  'PERSON',
  'EMAIL',
  'PHONE',
  'ADDRESS',
  'SSN',
  'CREDIT_CARD',
  'BANK_ACCOUNT',
  'DATE_OF_BIRTH',
  'PASSPORT',
  'DRIVER_LICENSE',
  'IP_ADDRESS',
  'URL',
  'USERNAME',
  'PASSWORD',
  'MEDICAL_ID',
  'NATIONAL_ID',
  'TAX_ID',
] as const;

export type PiiEntityType = (typeof PII_ENTITY_TYPES)[number];

export interface PiiEntity {
  type: PiiEntityType;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface DetectionResult {
  entities: PiiEntity[];
  processingTimeMs: number;
}

export const PII_RISK_POINTS: Record<PiiEntityType, number> = {
  PERSON: 5,
  EMAIL: 5,
  PHONE: 10,
  ADDRESS: 10,
  SSN: 25,
  CREDIT_CARD: 25,
  BANK_ACCOUNT: 20,
  DATE_OF_BIRTH: 5,
  PASSPORT: 20,
  DRIVER_LICENSE: 15,
  IP_ADDRESS: 5,
  URL: 2,
  USERNAME: 5,
  PASSWORD: 30,
  MEDICAL_ID: 20,
  NATIONAL_ID: 20,
  TAX_ID: 20,
};

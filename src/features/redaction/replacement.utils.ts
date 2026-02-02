import { faker } from '@faker-js/faker';
import { createHmac } from 'node:crypto';
import type { PiiEntityType } from '../../shared/types/pii.types.js';

/**
 * Generates consistent pseudonyms using HMAC-seeded PRNG.
 * Ensures referential integrity within a session scope.
 */
export function getDeterministicReplacement(
  originalText: string,
  type: PiiEntityType,
  salt: string
): string {
  const hash = createHmac('sha256', salt).update(originalText).digest('hex');
  const seed = parseInt(hash.substring(0, 8), 16);

  faker.seed(seed);

  switch (type) {
    case 'PERSON':
      return faker.person.fullName();

    case 'EMAIL':
      return faker.internet.email();

    case 'PHONE':
      return faker.phone.number();

    case 'ADDRESS':
      return faker.location.streetAddress();

    case 'SSN':
      return `${faker.string.numeric(3)}-${faker.string.numeric(2)}-${faker.string.numeric(4)}`;

    case 'CREDIT_CARD':
      return `${faker.string.numeric(4)}-${faker.string.numeric(4)}-${faker.string.numeric(4)}-${faker.string.numeric(4)}`;

    case 'BANK_ACCOUNT':
      return faker.finance.accountNumber();

    case 'DATE_OF_BIRTH':
      return faker.date
        .birthdate({ min: 18, max: 80, mode: 'age' })
        .toLocaleDateString('en-US');

    case 'PASSPORT':
      return `${faker.string.alpha({ length: 2, casing: 'upper' })}${faker.string.numeric(7)}`;

    case 'DRIVER_LICENSE':
      return `${faker.string.alpha({ length: 1, casing: 'upper' })}${faker.string.numeric(7)}`;

    case 'IP_ADDRESS':
      return faker.internet.ipv4();

    case 'URL':
      return faker.internet.url();

    case 'USERNAME':
      return `@${faker.internet.username()}`;

    case 'PASSWORD':
      return '[REDACTED_PASSWORD]';

    case 'MEDICAL_ID':
      return `MED${faker.string.numeric(8)}`;

    case 'NATIONAL_ID':
      return faker.string.numeric(10);

    case 'TAX_ID':
      return `${faker.string.numeric(2)}-${faker.string.numeric(7)}`;

    default:
      return '[REDACTED]';
  }
}

export function getSimpleRedaction(type: PiiEntityType): string {
  return `[${type}]`;
}

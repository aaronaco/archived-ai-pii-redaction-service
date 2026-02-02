import type { StoreClient } from '../../infrastructure/store/store-client.js';

/**
 * Abstraction layer for session and risk data persistence.
 * Uses key namespacing to segregate data types.
 */
export class SessionStore {
  private store: StoreClient;
  private readonly keyPrefix = 'session:';
  private readonly riskPrefix = 'risk:';

  constructor(store: StoreClient) {
    this.store = store;
  }

  async get(sessionId: string, field: string): Promise<string | null> {
    return this.store.hget(`${this.keyPrefix}${sessionId}`, field);
  }

  async increment(sessionId: string, field: string, amount = 1): Promise<number> {
    return this.store.hincrby(`${this.keyPrefix}${sessionId}`, field, amount);
  }

  /**
   * Atomically increments risk score and sets TTL on first write.
   * Handles multi-point increments via loop (due to Redis INCR limitations).
   */
  async incrementRisk(sessionId: string, points: number, windowMs: number): Promise<number> {
    const key = `${this.riskPrefix}${sessionId}`;
    const newScore = await this.store.incr(key);

    if (newScore === 1) {
      const windowSeconds = Math.ceil(windowMs / 1000);
      await this.store.expire(key, windowSeconds);
    }

    if (points > 1) {
      for (let i = 1; i < points; i++) {
        await this.store.incr(key);
      }
      return newScore + points - 1;
    }

    return newScore;
  }

  async getRiskScore(sessionId: string): Promise<number> {
    const score = await this.store.get(`${this.riskPrefix}${sessionId}`);
    return score ? parseInt(score, 10) : 0;
  }

  async isBanned(sessionId: string, threshold: number): Promise<boolean> {
    const score = await this.getRiskScore(sessionId);
    return score >= threshold;
  }

  async clearRisk(sessionId: string): Promise<void> {
    await this.store.del(`${this.riskPrefix}${sessionId}`);
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.store.del(`${this.keyPrefix}${sessionId}`);
    await this.store.del(`${this.riskPrefix}${sessionId}`);
  }
}

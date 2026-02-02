import { SessionStore } from './session.store.js';
import { PII_RISK_POINTS, type PiiEntity } from '../../shared/types/pii.types.js';

export interface RiskConfig {
  threshold: number;
  windowMs: number;
}

export interface RiskAssessment {
  score: number;
  isBanned: boolean;
  pointsAdded: number;
}

/**
 * Manages session risk scoring and access control policies.
 */
export class SessionService {
  private sessionStore: SessionStore;
  private config: RiskConfig;

  constructor(sessionStore: SessionStore, config: RiskConfig) {
    this.sessionStore = sessionStore;
    this.config = config;
  }

  /**
   * Calculates risk impact of detected entities and updates session state.
   * Triggers ban if threshold exceeded.
   */
  async assessRisk(sessionId: string, entities: PiiEntity[]): Promise<RiskAssessment> {
    if (entities.length === 0) {
      const currentScore = await this.sessionStore.getRiskScore(sessionId);
      return {
        score: currentScore,
        isBanned: currentScore >= this.config.threshold,
        pointsAdded: 0,
      };
    }

    let pointsToAdd = 0;
    for (const entity of entities) {
      const points = PII_RISK_POINTS[entity.type] || 5;
      pointsToAdd += points;
    }

    const newScore = await this.sessionStore.incrementRisk(
      sessionId,
      pointsToAdd,
      this.config.windowMs
    );

    const isBanned = newScore >= this.config.threshold;

    return {
      score: newScore,
      isBanned,
      pointsAdded: pointsToAdd,
    };
  }

  async isBanned(sessionId: string): Promise<boolean> {
    return this.sessionStore.isBanned(sessionId, this.config.threshold);
  }

  async getRiskScore(sessionId: string): Promise<number> {
    return this.sessionStore.getRiskScore(sessionId);
  }

  async clearRisk(sessionId: string): Promise<void> {
    await this.sessionStore.clearRisk(sessionId);
  }

  extractSessionId(headers: Record<string, string | string[] | undefined>, ip: string): string {
    const apiKey = headers['x-api-key'];
    if (apiKey) {
      return typeof apiKey === 'string' ? apiKey : apiKey[0] ?? ip;
    }

    const auth = headers['authorization'];
    if (auth) {
      const authStr = typeof auth === 'string' ? auth : auth[0] ?? '';
      return `auth:${Buffer.from(authStr).toString('base64').substring(0, 32)}`;
    }

    return `ip:${ip}`;
  }
}

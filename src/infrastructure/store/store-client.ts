import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/** LRU-like in-memory store for development or fallback. */
class InMemoryStore {
  private store = new Map<string, { value: string; expiresAt: number | null }>();
  private readonly maxSize = 10000;

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value as string;
      this.store.delete(firstKey);
    }

    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const newValue = (parseInt(current || '0', 10) + 1).toString();

    const entry = this.store.get(key);
    const ttlSeconds = entry?.expiresAt
      ? Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000))
      : undefined;

    await this.set(key, newValue, ttlSeconds);
    return parseInt(newValue, 10);
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;

    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const hashKey = `${key}:${field}`;
    const current = await this.get(hashKey);
    const newValue = parseInt(current || '0', 10) + increment;
    await this.set(hashKey, newValue.toString());
    return newValue;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.get(`${key}:${field}`);
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  async quit(): Promise<void> {
    this.store.clear();
  }
}

class RedisStore {
  private client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.client.on('error', (err: Error) => {
      console.error('Redis connection error:', err.message);
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.expire(key, ttlSeconds);
    return result === 1;
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.client.hincrby(key, field, increment);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }
}

/** Unified interface for key-value storage operations. */
export interface StoreClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<boolean>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  del(key: string): Promise<number>;
  quit(): Promise<void>;
}

/** Factory that returns Redis client or in-memory fallback based on config. */
export async function createStoreClient(): Promise<StoreClient> {
  if (env.REDIS_URL) {
    console.log('[INFO] Connecting to Redis...');
    const redisStore = new RedisStore(env.REDIS_URL);
    await redisStore.connect();
    console.log('[OK] Redis connected');
    return redisStore;
  }

  console.log('[INFO] Using in-memory store (no REDIS_URL provided)');
  return new InMemoryStore();
}

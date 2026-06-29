/**
 * Centralized Redis key patterns.
 * All keys go through these helpers to ensure consistency.
 */

export const redisKeys = {
  // Provider cache
  crossrefDoi: (doi: string) => `crossref:${doi}`,
  crossrefSearch: (hash: string) => `crossref:search:${hash}`,
  openalexDoi: (doi: string) => `openalex:${doi}`,
  openalexSearch: (hash: string) => `openalex:search:${hash}`,
  doiResolve: (doi: string) => `doi:resolve:${doi}`,

  // ML cache
  mlStyle: (hash: string) => `ml:style:${hash}`,
  mlExtract: (hash: string) => `ml:extract:${hash}`,

  // Rate limiting
  rateLimitUser: (userId: string, date: string) => `ratelimit:user:${userId}:${date}`,
  rateLimitApi: (keyHash: string, minute: string) => `ratelimit:api:${keyHash}:${minute}`,
  rateLimitIp: (ipHash: string, minute: string) => `ratelimit:ip:${ipHash}:${minute}`,
  authRevokedJti: (jti: string) => `auth:revoked-jti:${jti}`,
  /** WorkOS AuthKit access tokens carry `sid`; matches `session.revoked` webhook `data.id`. */
  authRevokedSession: (sessionId: string) => `auth:revoked-session:${sessionId}`,

  // Circuit breaker
  circuitMlService: () => 'circuit:ml-service',
} as const;

// TTLs in seconds
export const redisTtl = {
  crossrefDoi: 86_400,     // 24h
  crossrefSearch: 21_600,  // 6h
  openalexDoi: 86_400,     // 24h
  openalexSearch: 21_600,  // 6h
  doiResolve: 86_400,      // 24h
  mlStyle: 3_600,           // 1h
  mlExtract: 3_600,         // 1h
  circuitBreaker: 300,      // 5m
  rateLimit: 120,           // 2m
  authRevocation: 86_400,   // 24h fallback
} as const;

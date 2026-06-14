import type { Decision, AgentActionType } from '@GhostPR/shared-types';

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const hoursAgo = (h: number): string => {
  const d = new Date();
  d.setHours(d.getHours() - h);
  return d.toISOString();
};

// Fixed IDs so agent_log foreign keys work across rebuilds
export const SEED_IDS = {
  AUTH_JWT:       'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5',
  API_RATE_LIMIT: 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6',
  DB_POSTGRES:    'c3d4e5f6-a7b8-4c9d-0e1f-a2b3c4d5e6f7',
  QUEUE_BULLMQ:   'd4e5f6a7-b8c9-4d0e-1f2a-b3c4d5e6f7a8',
  API_GRAPHQL:    'e5f6a7b8-c9d0-4e1f-2a3b-c4d5e6f7a8b9',
  FRONT_APPROUTER:'f6a7b8c9-d0e1-4f2a-3b4c-d5e6f7a8b9c0',
  API_ZOD:        'a7b8c9d0-e1f2-4a3b-4c5d-e6f7a8b9c0d1',
  INFRA_DOCKER:   'b8c9d0e1-f2a3-4b4c-5d6e-f7a8b9c0d1e2',
};

export const seedDecisions: Omit<Decision, 'agentLog'>[] = [
  {
    id: SEED_IDS.AUTH_JWT,
    filePath: 'src/auth/middleware.ts',
    module: 'auth',
    summary: 'Use short-lived JWT access tokens (15 min) with rotating refresh tokens instead of long-lived sessions',
    reason:
      'Stateless JWT access tokens eliminate a shared session store, allowing horizontal scaling without sticky sessions. Long-lived sessions require every auth check to hit the database, creating a bottleneck as concurrency grows. Refresh token rotation provides revocation capability while keeping the hot path stateless.',
    result:
      'Auth database queries dropped 70% after rollout. Refresh token rotation successfully detected two credential-leakage incidents in the first month. Auth middleware is now deployed across six nodes with no shared state. Access token TTL of 15 minutes limits blast radius when tokens are exposed in logs.',
    lesson:
      'Pair short access token TTL with secure refresh rotation — always invalidate the old refresh token when issuing a new one to prevent replay attacks. Store refresh tokens hashed in the DB, not plaintext. Log the JTI on each refresh rotation so security incidents are traceable.',
    confidence: 0.94,
    status: 'active',
    created: daysAgo(180),
    lastValidated: daysAgo(30),
    source: {
      type: 'pr',
      url: 'https://github.com/example-corp/saas-platform/pull/412',
      author: 'alex-chen',
      refNumber: 412,
    },
  },
  {
    id: SEED_IDS.API_RATE_LIMIT,
    filePath: 'src/api/rateLimit.ts',
    module: 'api',
    summary: 'Implement sliding window rate limiting via Redis sorted sets, not fixed window counters',
    reason:
      'Fixed window counters allow burst traffic at window boundaries — a user can fire 2× the limit by straddling two windows. Sliding window with Redis sorted sets (ZADD + ZRANGEBYSCORE + ZREMRANGEBYSCORE) gives accurate per-user limits. The tradeoff is ~3 Redis ops per request vs 2 for fixed window, but at our traffic level this is negligible.',
    result:
      'API abuse incidents dropped 94% in the quarter after rollout. P99 latency unchanged at 28ms. Redis sorted set operations average 0.3ms. No false positives reported from legitimate burst patterns. Rate limit headers (X-RateLimit-Remaining, Retry-After) improved DX for API consumers.',
    lesson:
      'Sliding window costs ~1.5× the Redis operations of fixed window but eliminates the boundary burst problem entirely. Use sliding window for public-facing endpoints and fixed window only for internal endpoints where burst tolerance is acceptable. Always expose limit headers — silent limiting causes confusing client failures.',
    confidence: 0.89,
    status: 'active',
    created: daysAgo(220),
    lastValidated: daysAgo(45),
    source: {
      type: 'pr',
      url: 'https://github.com/example-corp/saas-platform/pull/387',
      author: 'sarah-kim',
      refNumber: 387,
    },
  },
  {
    id: SEED_IDS.DB_POSTGRES,
    filePath: 'src/database/connection.ts',
    module: 'database',
    summary: 'Use PostgreSQL as primary data store to leverage JSONB columns and native full-text search',
    reason:
      'JSONB with GIN indexes allows storing and querying semi-structured metadata without schema migrations for every attribute addition. MySQL 8 JSON support lacks operator indexing. PostgreSQL native full-text search (tsvector + tsquery) eliminates an Elasticsearch dependency for our current search needs.',
    result:
      'Metadata storage migrated to JSONB with GIN indexes in v1.4. Full-text search implemented in-database without additional infrastructure. Zero added services in the stack. The query planner efficiently handles hybrid queries mixing structured columns and JSONB filters. Search result latency at P95: 14ms.',
    lesson:
      'PostgreSQL JSONB is production-grade — avoid it only if you have a strong reason, not out of MySQL familiarity. Always run ANALYZE after bulk inserts into GIN-indexed JSONB columns; the planner needs fresh stats. Full-text search in Postgres is sufficient for up to ~10M rows; revisit Elasticsearch only when relevance tuning becomes a product requirement.',
    confidence: 0.91,
    status: 'active',
    created: daysAgo(310),
    lastValidated: daysAgo(60),
    source: {
      type: 'pr',
      url: 'https://github.com/example-corp/saas-platform/pull/301',
      author: 'marcus-dev',
      refNumber: 301,
    },
  },
  {
    id: SEED_IDS.QUEUE_BULLMQ,
    filePath: 'src/queue/processor.ts',
    module: 'queue',
    summary: 'Use BullMQ (Redis-backed) for background job processing over polling the database',
    reason:
      'Database polling for pending jobs creates write contention on the jobs table and forces a polling interval floor (we used 5 seconds). BullMQ uses Redis streams for push-based delivery, with built-in retries, exponential backoff, concurrency control, and the Bull Board UI for ops visibility — all features we would have had to build from scratch on a DB queue.',
    result:
      'Average job pickup latency dropped from 4.2 seconds (polling) to 180ms after migration. Failed job retry logic handled 3 transient outages without manual intervention. Bull Board UI replaced a bespoke internal dashboard. Database write contention on the jobs table eliminated entirely.',
    lesson:
      "Don't use the database as a queue. The DB queue pattern starts simple but accrues hidden costs: index bloat on the jobs table, thundering-herd on polling, and no built-in dead-letter handling. BullMQ's overhead of a Redis instance is justified once you have more than two job types. Size Redis separately from your main cache instance.",
    confidence: 0.87,
    status: 'active',
    created: daysAgo(140),
    lastValidated: daysAgo(20),
    source: {
      type: 'pr',
      url: 'https://github.com/example-corp/saas-platform/pull/445',
      author: 'priya-nair',
      refNumber: 445,
    },
  },
  {
    id: SEED_IDS.API_GRAPHQL,
    filePath: 'src/api/graphql/schema.ts',
    module: 'api',
    summary: 'Deprecated GraphQL API layer in v2.3 in favor of typed REST endpoints with OpenAPI spec',
    reason:
      "GraphQL was introduced for flexible client queries, but our single mobile client never exercised nested queries or fragments. Schema maintenance, N+1 protection (DataLoader), and the resolver abstraction layer consumed engineering time disproportionate to the value delivered. The flexibility was potential, not actual.",
    result:
      'GraphQL endpoint removed in v2.3. REST endpoints with Zod response schemas are simpler to cache (HTTP caching works naturally), rate-limit by endpoint, and document via OpenAPI. Client team reported 30% faster feature velocity after the switch. Bundle size reduced by removing apollo-client.',
    lesson:
      'GraphQL earns its complexity when clients have genuinely divergent query needs across multiple consumers. For APIs serving one or two clients with predictable access patterns, REST wins on operational simplicity. Make this evaluation before adopting GraphQL, not after 18 months of schema drift.',
    confidence: 0.38,
    status: 'deprecated',
    created: daysAgo(90),
    lastValidated: daysAgo(5),
    source: {
      type: 'pr',
      url: 'https://github.com/example-corp/saas-platform/pull/523',
      author: 'tom-walker',
      refNumber: 523,
    },
  },
  {
    id: SEED_IDS.FRONT_APPROUTER,
    filePath: 'src/app/layout.tsx',
    module: 'frontend',
    summary: 'Adopted Next.js 14 App Router over Pages Router for React Server Component architecture',
    reason:
      'App Router co-locates data fetching with UI components, eliminating prop-drilling from getServerSideProps through multiple layout levels. React Server Components reduce client JavaScript bundle size by keeping data-fetching logic on the server. Streaming with Suspense improves perceived load time for data-heavy pages.',
    result:
      'Initial page load improved 40%. Client bundle reduced 28%. However, several third-party libraries (drag-and-drop, animation, rich-text editors) required "use client" wrapper components that partially negate server component benefits. Team adaptation took ~6 weeks; two senior engineers reported reduced productivity during transition.',
    lesson:
      'App Router is the right long-term architectural bet but carries a steep learning curve and ecosystem risk. Audit your third-party library dependencies for RSC compatibility before migrating. Some patterns that are idiomatic in Pages Router (context providers at root, client-side navigation state) require rethinking. Factor in team onboarding time.',
    confidence: 0.68,
    status: 'questionable',
    created: daysAgo(110),
    lastValidated: null,
    source: {
      type: 'pr',
      url: 'https://github.com/example-corp/saas-platform/pull/489',
      author: 'lisa-wong',
      refNumber: 489,
    },
  },
  {
    id: SEED_IDS.API_ZOD,
    filePath: 'src/api/validation.ts',
    module: 'api',
    summary: 'Use Zod for runtime schema validation and TypeScript type inference, replacing class-validator',
    reason:
      'class-validator requires TypeScript experimental decorators (a non-standard TS feature), a separate class-transformer for deserialization, and reflect-metadata polyfills. It does not infer TypeScript types. Zod schemas are the single source of truth for both runtime validation and compile-time types, eliminating the divergence risk between types and validators.',
    result:
      'Removed class-validator, class-transformer, and reflect-metadata (3 dependencies). Schema definitions are 40% fewer lines on average. Types automatically propagate from API schema definitions to database and service layers. OpenAPI spec generation now driven from Zod schemas via zod-to-openapi. Zero type-runtime divergence bugs in 8 months.',
    lesson:
      "Define the Zod schema once and derive types, request parsing, response shaping, and OpenAPI documentation from it. The runtime + compile-time unity is the primary benefit — don't use Zod for just one side and manually define types separately. Use z.infer<typeof Schema> pervasively; it's the entire point.",
    confidence: 0.93,
    status: 'active',
    created: daysAgo(260),
    lastValidated: daysAgo(90),
    source: {
      type: 'pr',
      url: 'https://github.com/example-corp/saas-platform/pull/358',
      author: 'dev-aditi',
      refNumber: 358,
    },
  },
  {
    id: SEED_IDS.INFRA_DOCKER,
    filePath: 'infra/docker-compose.yml',
    module: 'infra',
    summary: 'Deploy via docker-compose on a single optimized node rather than Kubernetes for current scale',
    reason:
      'Kubernetes operational overhead — cluster management, RBAC configuration, networking policies, ingress controllers, node scaling — is disproportionate below 50k DAU. A single high-memory node with docker-compose, Caddy reverse proxy, and automated backups delivers our SLO at 65% lower infrastructure cost. The K8s migration path is preserved; this is a deferral, not a rejection.',
    result:
      'Infrastructure cost reduced 65% (managed K8s → single VPS). Deployment time: 45 seconds (docker compose pull && up -d) vs 8 minutes (Helm chart). On-call incidents attributable to infrastructure: 0 in the 6 months since migration. SLO: 99.95% uptime maintained. Single-node disk I/O is now the identified bottleneck to revisit at 30k DAU.',
    lesson:
      'Scale your infrastructure to your actual load, not your aspirational load. Kubernetes is not a prerequisite for reliability or professionalism. Document the specific metrics (DAU, team size, number of independent services) that will trigger the K8s migration, so the decision has a clear revisit condition rather than drifting forever.',
    confidence: 0.82,
    status: 'active',
    created: daysAgo(245),
    lastValidated: daysAgo(75),
    source: {
      type: 'pr',
      url: 'https://github.com/example-corp/saas-platform/pull/333',
      author: 'ops-rivera',
      refNumber: 333,
    },
  },
];

export interface SeedAgentLog {
  id: string;
  decisionId: string;
  action: AgentActionType;
  timestamp: string;
  result: string;
}

export const seedAgentLogs: SeedAgentLog[] = [
  // AUTH_JWT logs
  {
    id: 'log-auth-1',
    decisionId: SEED_IDS.AUTH_JWT,
    action: 'retrieved',
    timestamp: hoursAgo(15 * 24 + 2),
    result: 'Decision fetched while developer was implementing OAuth2 PKCE flow in auth/oauth.ts — confirmed JWT approach is compatible with OAuth token exchange.',
  },
  {
    id: 'log-auth-2',
    decisionId: SEED_IDS.AUTH_JWT,
    action: 'shown',
    timestamp: hoursAgo(10 * 24 + 1),
    result: 'Surfaced during code review of PR #604 (session timeout configuration). Reviewer asked why tokens expire so quickly; decision provided the rationale.',
  },
  {
    id: 'log-auth-3',
    decisionId: SEED_IDS.AUTH_JWT,
    action: 'accepted',
    timestamp: hoursAgo(10 * 24),
    result: 'Developer confirmed the JWT approach remains appropriate after reviewing the OAuth integration. PR merged with 15-minute access token TTL preserved.',
  },

  // API_RATE_LIMIT logs
  {
    id: 'log-rate-1',
    decisionId: SEED_IDS.API_RATE_LIMIT,
    action: 'retrieved',
    timestamp: hoursAgo(8 * 24 + 3),
    result: 'Queried before modifying rate limit thresholds for the new enterprise tier (10× limit). Decision confirmed sliding window approach handles variable limits correctly via a multiplier on the ZADD score.',
  },
  {
    id: 'log-rate-2',
    decisionId: SEED_IDS.API_RATE_LIMIT,
    action: 'shown',
    timestamp: hoursAgo(8 * 24),
    result: 'Presented to engineer reviewing api/rateLimit.ts — explained why ZRANGEBYSCORE is used over a simple INCR counter.',
  },

  // DB_POSTGRES logs
  {
    id: 'log-db-1',
    decisionId: SEED_IDS.DB_POSTGRES,
    action: 'retrieved',
    timestamp: hoursAgo(22 * 24 + 5),
    result: 'Fetched while evaluating CockroachDB for multi-region support. Decision context reviewed by the team.',
  },
  {
    id: 'log-db-2',
    decisionId: SEED_IDS.DB_POSTGRES,
    action: 'shown',
    timestamp: hoursAgo(22 * 24 + 4),
    result: 'Presented to engineering team in architecture review discussing database scaling options.',
  },
  {
    id: 'log-db-3',
    decisionId: SEED_IDS.DB_POSTGRES,
    action: 'ignored',
    timestamp: hoursAgo(22 * 24),
    result: 'CockroachDB evaluation halted after cost analysis. PostgreSQL JSONB decision remains authoritative — no change needed.',
  },

  // QUEUE_BULLMQ logs
  {
    id: 'log-queue-1',
    decisionId: SEED_IDS.QUEUE_BULLMQ,
    action: 'retrieved',
    timestamp: hoursAgo(5 * 24 + 1),
    result: 'Fetched before adding a new email notification job type to queue/processor.ts. Developer confirmed BullMQ queue pattern is the right abstraction.',
  },
  {
    id: 'log-queue-2',
    decisionId: SEED_IDS.QUEUE_BULLMQ,
    action: 'accepted',
    timestamp: hoursAgo(5 * 24),
    result: 'New email queue added following established BullMQ pattern. Decision reaffirmed as still appropriate.',
  },

  // API_GRAPHQL logs (deprecated)
  {
    id: 'log-gql-1',
    decisionId: SEED_IDS.API_GRAPHQL,
    action: 'retrieved',
    timestamp: hoursAgo(3 * 24 + 2),
    result: "New engineer found legacy GraphQL schema types in the codebase and queried the context. Decision surfaced explaining the deprecation.",
  },
  {
    id: 'log-gql-2',
    decisionId: SEED_IDS.API_GRAPHQL,
    action: 'shown',
    timestamp: hoursAgo(3 * 24),
    result: 'Deprecation rationale presented to prevent accidental GraphQL revival. Engineer confirmed the old schema types were leftover and deleted them.',
  },

  // FRONT_APPROUTER logs (questionable)
  {
    id: 'log-front-1',
    decisionId: SEED_IDS.FRONT_APPROUTER,
    action: 'retrieved',
    timestamp: hoursAgo(12 * 24 + 3),
    result: 'Queried while debugging hydration mismatch errors in the dashboard layout component. Developer wanted to understand App Router constraints.',
  },
  {
    id: 'log-front-2',
    decisionId: SEED_IDS.FRONT_APPROUTER,
    action: 'shown',
    timestamp: hoursAgo(12 * 24 + 1),
    result: 'Decision context shared with new frontend engineer to explain the App Router adoption rationale and known pain points.',
  },
  {
    id: 'log-front-3',
    decisionId: SEED_IDS.FRONT_APPROUTER,
    action: 'ignored',
    timestamp: hoursAgo(12 * 24),
    result: 'Engineer opted for a "use client" wrapper as a short-term fix rather than refactoring to RSC pattern. Tech debt logged.',
  },

  // API_ZOD logs
  {
    id: 'log-zod-1',
    decisionId: SEED_IDS.API_ZOD,
    action: 'retrieved',
    timestamp: hoursAgo(18 * 24 + 2),
    result: 'Fetched before adding a new /webhooks endpoint to confirm validation library choice and schema pattern.',
  },
  {
    id: 'log-zod-2',
    decisionId: SEED_IDS.API_ZOD,
    action: 'accepted',
    timestamp: hoursAgo(18 * 24),
    result: 'New webhook endpoint implemented with Zod schema following established pattern. z.infer<> used for request and response types.',
  },

  // INFRA_DOCKER logs
  {
    id: 'log-infra-1',
    decisionId: SEED_IDS.INFRA_DOCKER,
    action: 'retrieved',
    timestamp: hoursAgo(7 * 24 + 4),
    result: 'Queried during evaluation of ECS Fargate migration proposed by new infrastructure hire.',
  },
  {
    id: 'log-infra-2',
    decisionId: SEED_IDS.INFRA_DOCKER,
    action: 'shown',
    timestamp: hoursAgo(7 * 24),
    result: 'Decision and its metrics presented to CTO in infrastructure review. Single-node approach confirmed until 30k DAU threshold is reached.',
  },
];

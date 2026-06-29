import type { RouteOptions } from 'fastify';

export type RouteActor = 'anonymous' | 'authenticated' | 'org_admin' | 'admin';
export type RouteTenantScope = 'none' | 'user' | 'org' | 'job_token' | 'mixed';
export type RouteOwnershipRule =
  | 'none'
  | 'owner_only'
  | 'org_only'
  | 'job_token_or_owner'
  | 'admin_only'
  | 'admin_or_owner';
export type RouteRateLimitClass =
  | 'health'
  | 'webhook_signed'
  | 'public_contact'
  | 'public_auth'
  | 'public_engine'
  | 'authenticated_account'
  | 'org_admin'
  | 'admin_sensitive'
  | 'admin_general';

export interface RouteAuthorizationPolicy {
  id: string;
  methods: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
  path: RegExp;
  actor: RouteActor;
  tenantScope: RouteTenantScope;
  capability: string;
  ownership: RouteOwnershipRule;
  rateLimitClass: RouteRateLimitClass;
}

export interface RegisteredRouteSignature {
  method: string;
  path: string;
}

const VERIFIED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const routeAuthorizationMatrix: RouteAuthorizationPolicy[] = [
  {
    id: 'health.public',
    methods: ['GET'],
    path: /^\/(?:health|api\/engine\/health)$/u,
    actor: 'anonymous',
    tenantScope: 'none',
    capability: 'health_probe',
    ownership: 'none',
    rateLimitClass: 'health',
  },
  {
    id: 'webhooks.signed',
    methods: ['POST'],
    path: /^\/webhooks\/(?:clerk|workos)$/u,
    actor: 'anonymous',
    tenantScope: 'none',
    capability: 'signed_webhook_ingress',
    ownership: 'none',
    rateLimitClass: 'webhook_signed',
  },
  {
    id: 'workos.browser_proxy',
    methods: ['POST'],
    path: /^\/user_management\/authenticate$/u,
    actor: 'anonymous',
    tenantScope: 'none',
    capability: 'browser_auth_proxy',
    ownership: 'none',
    rateLimitClass: 'public_auth',
  },
  {
    id: 'public.contact_waitlist_analytics',
    methods: ['POST'],
    path: /^\/api\/(?:contact|waitlist|analytics\/track)$/u,
    actor: 'anonymous',
    tenantScope: 'none',
    capability: 'public_intake',
    ownership: 'none',
    rateLimitClass: 'public_contact',
  },
  {
    id: 'auth.catalog_and_requests',
    methods: ['GET', 'POST'],
    path: /^\/v1\/auth\/institutions(?:\/request-partnership)?$/u,
    actor: 'anonymous',
    tenantScope: 'none',
    capability: 'institution_lookup_or_request',
    ownership: 'none',
    rateLimitClass: 'public_auth',
  },
  {
    id: 'auth.session_probe',
    methods: ['GET'],
    path: /^\/v1\/auth\/session$/u,
    actor: 'anonymous',
    tenantScope: 'mixed',
    capability: 'session_probe_optional_auth',
    ownership: 'none',
    rateLimitClass: 'public_auth',
  },
  {
    id: 'auth.logout',
    methods: ['POST'],
    path: /^\/v1\/auth\/logout$/u,
    actor: 'authenticated',
    tenantScope: 'user',
    capability: 'session_or_token_logout',
    ownership: 'owner_only',
    rateLimitClass: 'authenticated_account',
  },
  {
    id: 'engine.runtime',
    methods: ['GET', 'POST', 'DELETE'],
    path: /^\/(?:v1|api\/engine)\/(?:inspect|convert(?:\/upload)?|corrections|reports|jobs\/[^/]+(?:\/(?:stream|events|pro-enrich(?:\/(?:accept|apply|preview))?))?|export\/[^/]+\/[^/]+)$/u,
    actor: 'anonymous',
    tenantScope: 'mixed',
    capability: 'citation_engine_runtime',
    ownership: 'job_token_or_owner',
    rateLimitClass: 'public_engine',
  },
  {
    id: 'keys.lifecycle',
    methods: ['GET', 'POST', 'DELETE'],
    path: /^\/v1\/keys(?:\/[^/]+)?$/u,
    actor: 'authenticated',
    tenantScope: 'user',
    capability: 'api_key_lifecycle',
    ownership: 'admin_or_owner',
    rateLimitClass: 'authenticated_account',
  },
  {
    id: 'history.user',
    methods: ['GET', 'PUT'],
    path: /^\/v1\/history$/u,
    actor: 'authenticated',
    tenantScope: 'user',
    capability: 'history_management',
    ownership: 'owner_only',
    rateLimitClass: 'authenticated_account',
  },
  {
    id: 'org.admin_context',
    methods: ['GET'],
    path: /^\/v1\/org\/context$/u,
    actor: 'org_admin',
    tenantScope: 'org',
    capability: 'org_admin_context',
    ownership: 'org_only',
    rateLimitClass: 'org_admin',
  },
  {
    id: 'internal.admin_session',
    methods: ['GET'],
    path: /^\/internal\/admin\/session$/u,
    actor: 'authenticated',
    tenantScope: 'user',
    capability: 'admin_session_probe',
    ownership: 'owner_only',
    rateLimitClass: 'authenticated_account',
  },
  {
    id: 'internal.admin_approve',
    methods: ['POST'],
    path: /^\/internal\/admin\/approve$/u,
    actor: 'admin',
    tenantScope: 'mixed',
    capability: 'admin_account_approval',
    ownership: 'admin_only',
    rateLimitClass: 'admin_sensitive',
  },
  {
    id: 'internal.admin_truth',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    path: /^\/internal\/admin\/approved-truth(?:\/.*)?$/u,
    actor: 'admin',
    tenantScope: 'mixed',
    capability: 'truth_governance',
    ownership: 'admin_only',
    rateLimitClass: 'admin_sensitive',
  },
  {
    id: 'internal.admin_general',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    path: /^\/internal\/admin\/(?!(?:session|approve)(?:\/|$)|approved-truth(?:\/|$)).+$/u,
    actor: 'admin',
    tenantScope: 'mixed',
    capability: 'admin_control_plane',
    ownership: 'admin_only',
    rateLimitClass: 'admin_general',
  },
  {
    id: 'internal.regression',
    methods: ['GET', 'POST'],
    path: /^\/internal\/regression\/.+$/u,
    actor: 'admin',
    tenantScope: 'mixed',
    capability: 'regression_orchestration',
    ownership: 'admin_only',
    rateLimitClass: 'admin_general',
  },
];

function normalizeRoutePath(path: string): string {
  const noQuery = path.split('?')[0] ?? '';
  const trimmed = noQuery.trim();
  if (!trimmed) return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+/gu, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}

function normalizeFastifyMethod(method: RouteOptions['method']): string[] {
  if (Array.isArray(method)) {
    return method.map((entry) => String(entry));
  }
  return [String(method)];
}

export function collectRegisteredRouteSignatures(
  routeOptions: RouteOptions,
  destination: RegisteredRouteSignature[],
): void {
  const path = normalizeRoutePath(routeOptions.url);
  for (const method of normalizeFastifyMethod(routeOptions.method)) {
    const normalizedMethod = normalizeMethod(method);
    if (!VERIFIED_METHODS.has(normalizedMethod)) {
      continue;
    }
    destination.push({
      method: normalizedMethod,
      path,
    });
  }
}

export function classifyRoute(
  route: RegisteredRouteSignature,
): RouteAuthorizationPolicy[] {
  const method = normalizeMethod(route.method);
  const path = normalizeRoutePath(route.path);
  return routeAuthorizationMatrix.filter((policy) =>
    policy.methods.includes(method as RouteAuthorizationPolicy['methods'][number])
    && policy.path.test(path),
  );
}

export function assertRouteAuthorizationMatrixCoverage(
  routes: RegisteredRouteSignature[],
): void {
  const uniqueRoutes = Array.from(
    new Map(
      routes.map((route) => [`${normalizeMethod(route.method)} ${normalizeRoutePath(route.path)}`, route]),
    ).values(),
  );

  const unclassified: string[] = [];
  const ambiguous: Array<{ route: string; policies: string[] }> = [];

  for (const route of uniqueRoutes) {
    const routeLabel = `${normalizeMethod(route.method)} ${normalizeRoutePath(route.path)}`;
    const matches = classifyRoute(route);
    if (matches.length === 0) {
      unclassified.push(routeLabel);
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push({
        route: routeLabel,
        policies: matches.map((policy) => policy.id),
      });
    }
  }

  if (unclassified.length === 0 && ambiguous.length === 0) {
    return;
  }

  const errorLines: string[] = ['Route authorization matrix coverage failed.'];

  if (unclassified.length > 0) {
    errorLines.push('Unclassified routes:');
    errorLines.push(...unclassified.map((route) => `- ${route}`));
  }

  if (ambiguous.length > 0) {
    errorLines.push('Ambiguous routes:');
    errorLines.push(...ambiguous.map((entry) => `- ${entry.route} -> ${entry.policies.join(', ')}`));
  }

  throw new Error(errorLines.join('\n'));
}

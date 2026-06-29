import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  real,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// 2.1 Tenant & Auth Tables
// ---------------------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 200 }).notNull(),
  domain: varchar('domain', { length: 200 }),
  tier: varchar('tier', { length: 20 }).default('free'), // free | pro | b2b
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

/** Maps IdP organization IDs (Clerk / WorkOS) to internal `organizations.id` (DB-authoritative tenancy). */
export const organizationIdentityLinks = pgTable(
  'organization_identity_links',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 40 }).notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_org_identity_links_provider_external').on(t.provider, t.externalId),
    index('idx_org_identity_links_org').on(t.organizationId),
  ],
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid('org_id').references(() => organizations.id),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 160 }),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  tier: varchar('tier', { length: 20 }).default('free'),
  dailyRefCount: integer('daily_ref_count').default(0),
  dailyRefReset: timestamp('daily_ref_reset', { withTimezone: true }).defaultNow(),
  isAdmin: boolean('is_admin').default(false),
  /** Set to `org_admin` for institutional org managers (cannot access global `/internal` admin). */
  appRole: varchar('app_role', { length: 32 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 120 }).notNull(),
    resource: varchar('resource', { length: 500 }).notNull(),
    resourceId: varchar('resource_id', { length: 255 }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    correlationId: varchar('correlation_id', { length: 128 }),
    statusCode: integer('status_code'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_audit_logs_created').on(t.createdAt),
    index('idx_audit_logs_actor').on(t.actorUserId),
    index('idx_audit_logs_org').on(t.orgId),
  ],
);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').references(() => users.id),
  orgId: uuid('org_id').references(() => organizations.id),
  name: varchar('name', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
    keyPrefix: varchar('key_prefix', { length: 8 }).notNull(),
    name: varchar('name', { length: 80 }),
    tier: varchar('tier', { length: 20 }).default('free'),
    rateLimit: integer('rate_limit'),
    isActive: boolean('is_active').default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_api_keys_hash').on(t.keyHash),
    index('idx_api_keys_user').on(t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_sessions_user').on(t.userId),
    index('idx_sessions_expires').on(t.expiresAt),
  ],
);

/** Per-user citation conversion history (JSON array), synced from the web app when signed in. */
export const userConversionHistory = pgTable('user_conversion_history', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  items: jsonb('items').notNull().$type<unknown[]>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Cluster-wide runtime override store for admin controls (e.g. phase-4 mode). */
export const runtimeOverrides = pgTable(
  'runtime_overrides',
  {
    key: varchar('key', { length: 80 }).primaryKey(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_runtime_overrides_updated').on(t.updatedAt)],
);

export const usage = pgTable(
  'usage',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id),
    orgId: uuid('org_id').references(() => organizations.id),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id),
    period: date('period').notNull(),
    scopeType: varchar('scope_type', { length: 20 }).notNull().default('global'),
    scopeKey: varchar('scope_key', { length: 200 }).notNull().default('global'),
    refCount: integer('ref_count').default(0),
    jobCount: integer('job_count').default(0),
    enrichCount: integer('enrich_count').default(0),
  },
  (t) => [
    uniqueIndex('ux_usage_period_scope').on(t.period, t.scopeType, t.scopeKey),
    index('idx_usage_user_period').on(t.userId, t.period),
    index('idx_usage_org_period').on(t.orgId, t.period),
    index('idx_usage_api_key_period').on(t.apiKeyId, t.period),
    index('idx_usage_scope_period').on(t.scopeType, t.scopeKey, t.period),
  ],
);

// ---------------------------------------------------------------------------
// 2.1.1 Egress Telemetry Tables
// ---------------------------------------------------------------------------

export const egressRequests = pgTable(
  'egress_requests',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    provider: varchar('provider', { length: 40 }).notNull(),
    route: varchar('route', { length: 200 }).notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    status: integer('status').notNull(),
    requestBodyBytes: integer('request_body_bytes').notNull(),
    responseBodyBytes: integer('response_body_bytes').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    cacheHit: boolean('cache_hit').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_egress_requests_created').on(t.createdAt),
    index('idx_egress_requests_provider').on(t.provider, t.createdAt),
    index('idx_egress_requests_route').on(t.route, t.createdAt),
    index('idx_egress_requests_corr').on(t.correlationId),
  ],
);

export const egressRollupsDaily = pgTable(
  'egress_rollups_daily',
  {
    period: date('period').notNull(),
    provider: varchar('provider', { length: 40 }).notNull(),
    route: varchar('route', { length: 200 }).notNull(),
    calls: integer('calls').default(0),
    cacheHits: integer('cache_hits').default(0),
    requestBodyBytes: integer('request_body_bytes').default(0),
    responseBodyBytes: integer('response_body_bytes').default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_egress_daily_period_provider_route').on(
      t.period,
      t.provider,
      t.route,
    ),
    index('idx_egress_daily_period').on(t.period),
    index('idx_egress_daily_provider').on(t.provider, t.period),
  ],
);

export const egressRollupsMonthly = pgTable(
  'egress_rollups_monthly',
  {
    period: varchar('period', { length: 7 }).notNull(), // YYYY-MM
    provider: varchar('provider', { length: 40 }).notNull(),
    route: varchar('route', { length: 200 }).notNull(),
    calls: integer('calls').default(0),
    cacheHits: integer('cache_hits').default(0),
    requestBodyBytes: integer('request_body_bytes').default(0),
    responseBodyBytes: integer('response_body_bytes').default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_egress_monthly_period_provider_route').on(
      t.period,
      t.provider,
      t.route,
    ),
    index('idx_egress_monthly_period').on(t.period),
    index('idx_egress_monthly_provider').on(t.provider, t.period),
  ],
);

// ---------------------------------------------------------------------------
// 2.1.2 External Identity Links
// ---------------------------------------------------------------------------

export const identityLinks = pgTable(
  'identity_links',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 40 }).notNull(), // clerk | workos | other
    externalId: varchar('external_id', { length: 255 }).notNull(), // sub claim
    email: varchar('email', { length: 255 }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_identity_links_provider_external').on(t.provider, t.externalId),
    index('idx_identity_links_user').on(t.userId),
    index('idx_identity_links_email').on(t.email),
  ],
);

// ---------------------------------------------------------------------------
// 2.2 Engine Tables
// ---------------------------------------------------------------------------

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id),
    orgId: uuid('org_id').references(() => organizations.id),
    projectId: uuid('project_id').references(() => projects.id),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).unique(),
    status: varchar('status', { length: 20 }).default('pending'),
    tier: varchar('tier', { length: 20 }).default('free'),
    // pending | processing | completed | partial | failed
    executionMode: varchar('execution_mode', { length: 10 }).default('sync'),
    sourceType: varchar('source_type', { length: 20 }).notNull(),
    inputHash: varchar('input_hash', { length: 64 }),
    outputStyle: varchar('output_style', { length: 40 }).notNull().default('apa7'),
    options: jsonb('options').default({}),
    pipelineMajor: integer('pipeline_major').notNull().default(3),
    totalRefs: integer('total_refs').default(0),
    processedRefs: integer('processed_refs').default(0),
    failedRefs: integer('failed_refs').default(0),
    currentPhase: varchar('current_phase', { length: 30 }),
    countAudit: jsonb('count_audit'),
    summary: jsonb('summary'),
    failedIndices: integer('failed_indices').array().default(sql`'{}'`),
    retryPayload: jsonb('retry_payload'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_jobs_user').on(t.userId),
    index('idx_jobs_status').on(t.status),
    index('idx_jobs_status_tier').on(t.status, t.tier),
    index('idx_jobs_status_org').on(t.status, t.orgId),
    index('idx_jobs_status_user').on(t.status, t.userId),
    index('idx_jobs_status_api_key').on(t.status, t.apiKeyId),
    index('idx_jobs_hash').on(t.inputHash),
    index('idx_jobs_created').on(t.createdAt),
  ],
);

export const ingestedSources = pgTable('ingested_sources', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  sourceType: varchar('source_type', { length: 20 }).notNull(),
  blobKey: varchar('blob_key', { length: 500 }),
  rawTextHash: varchar('raw_text_hash', { length: 64 }),
  fileSize: integer('file_size'),
  pageCount: integer('page_count'),
  retainedUntil: timestamp('retained_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const jobAttempts = pgTable('job_attempts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  error: jsonb('error'),
  stageLog: jsonb('stage_log').default([]),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const batches = pgTable('batches', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  batchIndex: integer('batch_index').notNull(),
  rawBlocks: jsonb('raw_blocks').notNull(),
  countAudit: jsonb('count_audit').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const citations = pgTable(
  'citations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id').references(() => batches.id),
    userId: uuid('user_id').references(() => users.id),
    referenceIndex: integer('reference_index').notNull(),
    rawText: text('raw_text').notNull(),
    referenceType: varchar('reference_type', { length: 40 }).default('unknown'),
    detectedStyle: varchar('detected_style', { length: 40 }),
    outputStyle: varchar('output_style', { length: 40 }).notNull(),
    pipelineMajor: integer('pipeline_major').notNull().default(3),
    publicStatus: varchar('public_status', { length: 20 }).notNull().default('needs_review'),
    // ready | needs_review | needs_action
    status: varchar('status', { length: 20 }).default('active'),
    // active | duplicate | flagged | failed
    duplicateOf: uuid('duplicate_of'),
    // Self-reference handled via raw SQL reference; Drizzle doesn't support self-refs in table def
    fields: jsonb('fields').notNull().default({}),
    rawScore: real('raw_score'),
    displayScore: real('display_score'),
    authorityFlags: jsonb('authority_flags').default([]),
    authorityCheckedAt: timestamp('authority_checked_at', { withTimezone: true }),
    renderedText: text('rendered_text'),
    renderedWarnings: text('rendered_warnings').array().default(sql`'{}'`),
    stageLog: jsonb('stage_log').default([]),
    splitMeta: jsonb('split_meta'),
    extractionMeta: jsonb('extraction_meta'),
    enrichmentMeta: jsonb('enrichment_meta'),
    normalizationMeta: jsonb('normalization_meta'),
    provenanceMeta: jsonb('provenance_meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_citations_job').on(t.jobId),
    index('idx_citations_user').on(t.userId),
    index('idx_citations_status').on(t.status),
    index('idx_citations_public').on(t.publicStatus),
    index('idx_citations_job_public_index').on(t.jobId, t.publicStatus, t.referenceIndex),
    index('idx_citations_created').on(t.createdAt),
  ],
);

export const citationVersions = pgTable('citation_versions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  citationId: uuid('citation_id').references(() => citations.id, { onDelete: 'cascade' }),
  versionNum: integer('version_num').notNull(),
  fields: jsonb('fields').notNull(),
  changedBy: varchar('changed_by', { length: 20 }),
  changeSource: varchar('change_source', { length: 40 }),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow(),
});

export const citationExtractionHistory = pgTable(
  'citation_extraction_history',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    citationId: uuid('citation_id').notNull(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    runMode: varchar('run_mode', { length: 20 }).notNull(),
    modelVersion: varchar('model_version', { length: 80 }),
    featureVersion: varchar('feature_version', { length: 80 }),
    styleUsed: varchar('style_used', { length: 40 }).notNull(),
    overallConfidence: real('overall_confidence'),
    fieldConfidences: jsonb('field_confidences').notNull().default({}),
    uncertainFields: text('uncertain_fields').array().notNull().default(sql`'{}'`),
    entities: jsonb('entities'),
    bio: jsonb('bio'),
    shadowDiff: jsonb('shadow_diff'),
    mlError: jsonb('ml_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_citation_extraction_history_citation').on(t.citationId, t.createdAt),
    index('idx_citation_extraction_history_job').on(t.jobId, t.createdAt),
  ],
);

export const duplicateGroups = pgTable('duplicate_groups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  primaryId: uuid('primary_id').references(() => citations.id),
  memberIds: uuid('member_ids').array().notNull(),
  method: varchar('method', { length: 20 }),
  jaccardScore: real('jaccard_score'),
  autoMerged: boolean('auto_merged').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const exportArtifacts = pgTable('export_artifacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  format: varchar('format', { length: 10 }).notNull(),
  blobKey: varchar('blob_key', { length: 500 }),
  inlineContent: text('inline_content'),
  sizeBytes: integer('size_bytes'),
  retainedUntil: timestamp('retained_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const providerCache = pgTable(
  'provider_cache',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: varchar('provider', { length: 20 }).notNull(),
    cacheKey: varchar('cache_key', { length: 128 }).notNull().unique(),
    payload: jsonb('payload').notNull(),
    hitCount: integer('hit_count').default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_provider_cache_key').on(t.cacheKey),
    index('idx_provider_cache_expires').on(t.expiresAt),
  ],
);

export const authorityChecks = pgTable('authority_checks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  citationId: uuid('citation_id').references(() => citations.id),
  doi: varchar('doi', { length: 200 }),
  retractionHit: boolean('retraction_hit').default(false),
  expressionOfConcern: boolean('expression_of_concern').default(false),
  authorConflict: boolean('author_conflict').default(false),
  flags: jsonb('flags').default([]),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  nextRecheckAt: timestamp('next_recheck_at', { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// 2.3 Reports, Corrections & Learning Tables
// ---------------------------------------------------------------------------

export const citationReports = pgTable(
  'citation_reports',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    citationId: uuid('citation_id').references(() => citations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    source: varchar('source', { length: 20 }).default('user'),
    failureCategory: varchar('failure_category', { length: 30 }).notNull(),
    failureCategories: text('failure_categories').array().default(sql`'{}'`),
    userNote: text('user_note'),
    status: varchar('status', { length: 20 }).default('pending'),
    fingerprint: varchar('fingerprint', { length: 64 }),
    reportCount: integer('report_count').default(1),
    ipHash: varchar('ip_hash', { length: 64 }),
    engineSnapshot: jsonb('engine_snapshot'),
    stageBlame: jsonb('stage_blame'),
    correctedFields: jsonb('corrected_fields'),
    resolutionTrace: jsonb('resolution_trace'),
    reviewState: jsonb('review_state'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_reports_citation').on(t.citationId),
    index('idx_reports_job_status_updated').on(t.jobId, t.status, t.updatedAt),
    index('idx_reports_status').on(t.status),
    index('idx_reports_fingerprint').on(t.fingerprint),
  ],
);

export const batchHealthSummaries = pgTable(
  'batch_health_summaries',
  {
    jobId: uuid('job_id')
      .primaryKey()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    ownerLabel: varchar('owner_label', { length: 255 }).notNull(),
    ownerType: varchar('owner_type', { length: 20 }).notNull(),
    outputStyle: varchar('output_style', { length: 40 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    latestActionableAt: timestamp('latest_actionable_at', { withTimezone: true }),
    totalCitations: integer('total_citations').notNull().default(0),
    flaggedCitationCount: integer('flagged_citation_count').notNull().default(0),
    readyCount: integer('ready_count').notNull().default(0),
    needsReviewCount: integer('needs_review_count').notNull().default(0),
    needsActionCount: integer('needs_action_count').notNull().default(0),
    openPendingReportCount: integer('open_pending_report_count').notNull().default(0),
    openProposedReportCount: integer('open_proposed_report_count').notNull().default(0),
    openReportTotal: integer('open_report_total').notNull().default(0),
    healthLabel: varchar('health_label', { length: 20 }).notNull(),
    queueSource: varchar('queue_source', { length: 20 }).notNull(),
    inQueue: boolean('in_queue').notNull().default(false),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_batch_health_in_queue_latest').on(t.inQueue, t.latestActionableAt),
    index('idx_batch_health_label_source').on(t.healthLabel, t.queueSource),
  ],
);

export const userCorrections = pgTable(
  'user_corrections',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    citationId: uuid('citation_id').references(() => citations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    fieldName: varchar('field_name', { length: 60 }).notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    correctionType: varchar('correction_type', { length: 20 }),
    status: varchar('status', { length: 20 }).default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_corrections_citation').on(t.citationId),
    index('idx_corrections_job').on(t.jobId),
    index('idx_corrections_status').on(t.status),
  ],
);

export const approvedTruth = pgTable('approved_truth', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  inputHash: varchar('input_hash', { length: 64 }).notNull().unique(),
  rawText: text('raw_text').notNull(),
  expectedFields: jsonb('expected_fields').notNull(),
  coreTruth: jsonb('core_truth'),
  overlayTruth: jsonb('overlay_truth'),
  expectedType: varchar('expected_type', { length: 40 }),
  expectedStyle: varchar('expected_style', { length: 40 }),
  provenance: varchar('provenance', { length: 50 }),
  pipelineMajor: integer('pipeline_major'),
  datasetSplit: varchar('dataset_split', { length: 20 }),
  trustLevel: varchar('trust_level', { length: 20 }).default('draft'),
  rowStatus: varchar('row_status', { length: 20 }).default('draft'),
  blockedReason: varchar('blocked_reason', { length: 40 }),
  taskCertifications: jsonb('task_certifications'),
  workId: varchar('work_id', { length: 120 }),
  familyId: varchar('family_id', { length: 120 }),
  variantId: varchar('variant_id', { length: 120 }),
  canonicalWorkKey: varchar('canonical_work_key', { length: 160 }),
  nearDupClusterId: varchar('near_dup_cluster_id', { length: 160 }),
  datasetVersion: varchar('dataset_version', { length: 80 }),
  inputProfile: varchar('input_profile', { length: 40 }),
  styleInferabilityTier: varchar('style_inferability_tier', { length: 40 }),
  styleEvaluationSuite: varchar('style_evaluation_suite', { length: 40 }),
  isAdversarial: boolean('is_adversarial'),
  difficultyTier: varchar('difficulty_tier', { length: 20 }),
  highImpact: boolean('high_impact'),
  highImpactReason: varchar('high_impact_reason', { length: 80 }),
  holdoutVersion: varchar('holdout_version', { length: 40 }),
  inferabilityByField: jsonb('inferability_by_field'),
  goldKind: varchar('gold_kind', { length: 40 }),
  adversarialPair: varchar('adversarial_pair', { length: 80 }),
  noiseProfile: jsonb('noise_profile'),
  approvalSource: varchar('approval_source', { length: 40 }),
  reviewedBy: varchar('reviewed_by', { length: 120 }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const approvedTruthRenderVariants = pgTable(
  'approved_truth_render_variants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    truthRowId: uuid('truth_row_id')
      .notNull()
      .references(() => approvedTruth.id, { onDelete: 'cascade' }),
    style: varchar('style', { length: 40 }).notNull(),
    generatedText: text('generated_text').notNull(),
    renderedText: text('rendered_text').notNull(),
    sourceKind: varchar('source_kind', { length: 20 }).notNull(),
    approvalStatus: varchar('approval_status', { length: 20 }).notNull(),
    qualityTier: varchar('quality_tier', { length: 20 }).notNull(),
    datasetLane: varchar('dataset_lane', { length: 20 }).notNull(),
    rendererVersion: varchar('renderer_version', { length: 80 }).notNull(),
    stale: boolean('stale').notNull().default(false),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: varchar('approved_by', { length: 120 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_approved_truth_render_variants_truth_style').on(t.truthRowId, t.style),
    index('idx_approved_truth_render_variants_truth_row').on(t.truthRowId, t.updatedAt),
    index('idx_approved_truth_render_variants_style').on(t.style, t.updatedAt),
  ],
);

export const approvedTruthEditorDrafts = pgTable(
  'approved_truth_editor_drafts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [index('idx_approved_truth_editor_drafts_user').on(t.userId)],
);

export const truthBackgroundJobs = pgTable(
  'truth_background_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    operation: varchar('operation', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    payload: jsonb('payload').notNull().default({}),
    error: text('error'),
    leaseOwner: varchar('lease_owner', { length: 120 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_truth_background_jobs_status_updated').on(t.status, t.updatedAt),
    index('idx_truth_background_jobs_lease_expires').on(t.leaseExpiresAt),
    index('idx_truth_background_jobs_created').on(t.createdAt),
  ],
);

export const activeLearningQueue = pgTable(
  'active_learning_queue',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    citationId: uuid('citation_id').references(() => citations.id),
    correctionId: uuid('correction_id').references(() => userCorrections.id),
    reportId: uuid('report_id').references(() => citationReports.id),
    source: varchar('source', { length: 20 }),
    maturityLevel: varchar('maturity_level', { length: 20 }).default('manual'),
    priority: integer('priority').default(0),
    trainingData: jsonb('training_data').notNull(),
    processed: boolean('processed').default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    promotedToTruthId: uuid('promoted_to_truth_id').references(() => approvedTruth.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [index('idx_learning_queue_processed').on(t.processed, t.priority)],
);

export const regressionFixtures = pgTable('regression_fixtures', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  suiteName: varchar('suite_name', { length: 80 }).notNull(),
  verbatimInput: text('verbatim_input').notNull(),
  expectedOutput: jsonb('expected_output').notNull(),
  failureMode: varchar('failure_mode', { length: 60 }),
  provenance: varchar('provenance', { length: 50 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const regressionRuns = pgTable('regression_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  runAt: timestamp('run_at', { withTimezone: true }).notNull(),
  pipelineMajor: integer('pipeline_major').notNull(),
  stageId: varchar('stage_id', { length: 50 }),
  suiteName: varchar('suite_name', { length: 80 }),
  passCount: integer('pass_count').default(0),
  failCount: integer('fail_count').default(0),
  skipCount: integer('skip_count').default(0),
  failures: jsonb('failures').default([]),
  triggeredBy: varchar('triggered_by', { length: 30 }),
});

export const legacyCitations = pgTable('legacy_citations', {
  citationId: uuid('citation_id')
    .references(() => citations.id)
    .primaryKey(),
  legacyVersion: text('legacy_version'),
  missingFields: jsonb('missing_fields').default([]),
  reviewStatus: text('review_status').default('unreviewed'),
  flaggedAt: timestamp('flagged_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// 2.x Enrichment recovery — cross-job reuse cache + BIO-training candidate sink
// ---------------------------------------------------------------------------

/**
 * Verified enrichment metadata cached by canonical key (DOI / title+year+author work-key) so the
 * SAME reference in a FUTURE job is promoted straight to ready without re-enriching. A NULL userId
 * row is the shared/global entry; a non-NULL userId row is that user's private copy. Partial unique
 * indexes dedup per-user and global rows separately (Postgres treats NULL userId as distinct).
 */
export const enrichedReferenceCache = pgTable(
  'enriched_reference_cache',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    doi: varchar('doi', { length: 200 }),
    canonicalWorkKey: varchar('canonical_work_key', { length: 200 }),
    fields: jsonb('fields').notNull(),
    sourceProvider: varchar('source_provider', { length: 40 }),
    matchConfidence: real('match_confidence'),
    hitCount: integer('hit_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_enriched_cache_user_doi')
      .on(t.userId, t.doi)
      .where(sql`user_id IS NOT NULL AND doi IS NOT NULL`),
    uniqueIndex('ux_enriched_cache_user_work')
      .on(t.userId, t.canonicalWorkKey)
      .where(sql`user_id IS NOT NULL AND canonical_work_key IS NOT NULL`),
    uniqueIndex('ux_enriched_cache_global_doi')
      .on(t.doi)
      .where(sql`user_id IS NULL AND doi IS NOT NULL`),
    uniqueIndex('ux_enriched_cache_global_work')
      .on(t.canonicalWorkKey)
      .where(sql`user_id IS NULL AND canonical_work_key IS NOT NULL`),
    index('idx_enriched_cache_doi').on(t.doi),
    index('idx_enriched_cache_work_key').on(t.canonicalWorkKey),
  ],
);

/**
 * Durable record of BIO-training candidates produced by pro enrichment recovery — the prod-safe
 * sibling of the inbox.jsonl review queue (Render's fs is ephemeral). Rows carry
 * provenance='enrichment_recovery' + needs_review=true so the normal certification flow gates them;
 * they are never trained on directly. Deduped by input hash.
 */
export const bioCandidateSink = pgTable(
  'bio_candidate_sink',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    inputHash: varchar('input_hash', { length: 80 }).notNull(),
    rawText: text('raw_text').notNull(),
    expectedType: varchar('expected_type', { length: 40 }),
    entityFields: text('entity_fields').array().notNull(),
    entityStarts: integer('entity_starts').array().notNull(),
    entityEnds: integer('entity_ends').array().notNull(),
    expectedFields: jsonb('expected_fields'),
    unprojectedFields: text('unprojected_fields').array().default(sql`'{}'`),
    datasetSplit: varchar('dataset_split', { length: 20 }).default('train'),
    trustLevel: varchar('trust_level', { length: 20 }).default('draft'),
    provenance: varchar('provenance', { length: 60 }).notNull(),
    needsReview: boolean('needs_review').notNull().default(true),
    reviewed: boolean('reviewed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_bio_candidate_input_hash').on(t.inputHash),
    index('idx_bio_candidate_needs_review').on(t.needsReview, t.reviewed),
    index('idx_bio_candidate_provenance').on(t.provenance),
  ],
);

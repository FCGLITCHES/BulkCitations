import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "node:crypto";
import multer from "multer";
import * as mammoth from "mammoth";
import * as pdfParseModule from "pdf-parse-new";
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> =
  typeof pdfParseModule === "function" ? pdfParseModule : (pdfParseModule?.default ?? pdfParseModule);
import { storage } from "./storage";
import reportsRouter from "./routes/reports";
import historyRouter from "./routes/history";
import v2Router from "./routes/v2";
import {
  adminAccessRequestSchema,
  adminApprovalSchema,
  adminLoginRequestSchema,
  conversionRequestSchema,
  contactRequestSchema,
  institutionPartnershipRequestSchema,
  institutionalLoginRequestSchema,
  institutionalRegistrationRequestSchema,
  publicLoginRequestSchema,
  publicRegistrationRequestSchema,
  waitlistRequestSchema,
  type ConvertedReference,
  type ConversionResponse,
  type DuplicateGroup,
} from "@shared/schema";
import { processReferences, reformatReferences, initCSLStyles } from "./engine/index";
import { runAssertions } from "./engine/strictRenderer.js";
import { processV2Conversion } from "./engine/v2/index.js";
import { mapV2ResponseToLegacyRecords } from "./engine/v2/compat.js";
import { applyTruthToLegacyReference } from "./engine/shared/truthResolver.js";
import { attachReferencePayloads } from "./engine/shared/referencePayloads.js";
import { runSanityCheck } from "./engine/stages/sanityCheck.js";
import { getAuthorityData } from "../shared/authorityLookup";
import { calculateConfidence } from "../shared/confidence";
import { computeRulesScore } from "../shared/computeRulesScore";
import {
  sendAdminAccessRequestAutoReply,
  sendAdminAccessRequestNotification,
  sendContactAutoReply,
  sendContactNotification,
  sendWaitlistAutoReply,
  sendWaitlistNotification,
} from "./utils/email";
import { getAnalyticsSummary, trackAnalyticsEvent, type AnalyticsEventType, type AnalyticsMetadataValue } from "./store/analyticsStore.js";
import {
  checkAdminLoginRateLimit,
  clearAdminLoginFailures,
  clearAdminSessionCookie,
  getAdminSessionStatus,
  isAdminAuthConfigured,
  requireAdmin,
  recordFailedAdminLogin,
  setAdminSessionCookie,
} from "./utils/adminAuth.js";
import {
  approveAdminAccessRequest,
  createAdminAccessRequest,
  findAdminAccountByEmailOrUsername,
  getApprovedAdminByIdentifier,
  verifyAdminAccountPassword,
} from "./store/adminAuthStore.js";
import { normalizeInstitutionSearchQuery, publicAuthStore, verifyPublicAccountPassword } from "./store/publicAuthStore.js";
import {
  checkPublicLoginRateLimit,
  clearPublicLoginFailures,
  clearPublicSessionCookie,
  getPublicSessionStatus,
  isPublicAuthConfigured,
  recordFailedPublicLogin,
  setPublicSessionCookie,
} from "./utils/userAuth.js";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize CSL styles at startup
  initCSLStyles();

  // Configure multer for file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  });

  function getRulesScoreForStoredReference(ref: Awaited<ReturnType<typeof storage.getReference>>) {
    if (!ref?.parsedData || !ref.convertedText || !ref.outputStyle) {
      return ref?.confidenceScore ?? 100;
    }

    let warnings = runAssertions(ref.outputStyle, ref.convertedText, ref.parsedData).warnings;
    const parseWarnings = (ref.parsedData?.parseWarnings ?? []).map((warning: string) => `parse: ${warning}`);
    if (parseWarnings.length > 0) warnings = [...parseWarnings, ...warnings];
    const sanityWarnings = runSanityCheck(ref.convertedText, ref.outputStyle).warnings;
    if (sanityWarnings.length > 0) warnings = [...warnings, ...sanityWarnings];

    return computeRulesScore(warnings);
  }

  function getStableConfidenceForStoredReference(ref: Awaited<ReturnType<typeof storage.getReference>>) {
    if (!ref?.parsedData) {
      return undefined;
    }

    if (typeof ref.confidenceScore === "number" && Number.isFinite(ref.confidenceScore)) {
      return calculateConfidence(ref.parsedData, ref.confidenceScore);
    }

    return calculateConfidence(ref.parsedData, getRulesScoreForStoredReference(ref));
  }

  function coerceIncomingReferences(data: { references?: string[]; content?: string }) {
    const explicitReferences = (data.references ?? [])
      .map((reference) => reference.trim())
      .filter(Boolean);
    if (explicitReferences.length > 0) return explicitReferences;

    const rawContent = String(data.content ?? '').trim();
    if (!rawContent) return [];

    const paragraphBlocks = rawContent
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean);
    if (paragraphBlocks.length > 1) return paragraphBlocks;

    const numberedBlocks: string[] = [];
    let current = '';
    for (const line of rawContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const numberedStart = trimmed.match(/^\s*(?:\[\d+\]|\d+[.):\-])\s*(.+)$/);
      if (numberedStart) {
        if (current.trim()) numberedBlocks.push(current.trim());
        current = numberedStart[1];
        continue;
      }
      current = current ? `${current} ${trimmed}` : trimmed;
    }
    if (current.trim()) numberedBlocks.push(current.trim());
    if (numberedBlocks.length > 1) return numberedBlocks;

    return [rawContent];
  }

  function normalizeAnalyticsCountryCode(value: unknown): string {
    if (typeof value !== "string") return "unknown";
    const normalized = value.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(normalized) ? normalized : "unknown";
  }

  function getAnalyticsCountryContext(req: Request) {
    const candidates: Array<{ header: string; value: unknown; source: string }> = [
      { header: "x-vercel-ip-country", value: req.headers["x-vercel-ip-country"], source: "vercel" },
      { header: "cf-ipcountry", value: req.headers["cf-ipcountry"], source: "cloudflare" },
      { header: "cloudfront-viewer-country", value: req.headers["cloudfront-viewer-country"], source: "cloudfront" },
      { header: "x-country-code", value: req.headers["x-country-code"], source: "custom" },
      { header: "x-appengine-country", value: req.headers["x-appengine-country"], source: "appengine" },
    ];

    for (const candidate of candidates) {
      const countryCode = normalizeAnalyticsCountryCode(candidate.value);
      if (countryCode !== "unknown") {
        return {
          countryCode,
          countryHeaderSource: candidate.source,
          countryHeaderName: candidate.header,
        };
      }
    }

    return {
      countryCode: "unknown",
      countryHeaderSource: "none",
      countryHeaderName: "none",
    };
  }

  function normalizeVisitorId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(normalized)) return null;
    return normalized;
  }

  function getBaseUrl(req: Request) {
    const configured = process.env.APP_URL?.trim() || process.env.PUBLIC_APP_URL?.trim();
    if (configured) {
      return configured.replace(/\/+$/, "");
    }

    const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
    const protocol = forwardedProto || req.protocol || "https";
    const host = req.get("host");
    return host ? `${protocol}://${host}` : "https://bulkreferences.com";
  }

  function normalizeAnalyticsPath(value: unknown): string {
    if (typeof value !== "string") return "/";
    const normalized = value.trim();
    if (!normalized.startsWith("/")) return "/";
    return normalized.slice(0, 120) || "/";
  }

  function normalizeRouteName(path: string, value: unknown): string {
    if (typeof value === "string") {
      const normalized = value.trim().slice(0, 80);
      if (normalized.length > 0) return normalized;
    }
    return path === "/" ? "home" : path.replace(/^\/+|\/+$/g, "").replace(/\//g, ":").slice(0, 80) || "home";
  }

  function sanitizeAnalyticsMetadata(value: unknown): Record<string, AnalyticsMetadataValue> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

    const entries: Array<[string, AnalyticsMetadataValue]> = [];
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
      if (raw == null) {
        entries.push([key, null]);
        continue;
      }
      if (typeof raw === "boolean") {
        entries.push([key, raw]);
        continue;
      }
      if (typeof raw === "number" && Number.isFinite(raw)) {
        entries.push([key, Number(raw.toFixed(2))]);
        continue;
      }
      if (typeof raw === "string") {
        entries.push([key, raw.trim().slice(0, 120)]);
      }
    }

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  async function recordSiteAnalyticsEvent(args: {
    req: Request;
    eventType: AnalyticsEventType;
    visitorId: string;
    path: string;
    metadata?: Record<string, AnalyticsMetadataValue>;
  }) {
    const country = getAnalyticsCountryContext(args.req);
    await trackAnalyticsEvent({
      id: randomUUID(),
      visitorId: args.visitorId,
      eventType: args.eventType,
      path: args.path,
      countryCode: country.countryCode,
      createdAt: new Date().toISOString(),
      metadata: {
        ...args.metadata,
        routeName: normalizeRouteName(args.path, args.metadata?.routeName),
        countryHeaderSource: country.countryHeaderSource,
        countryHeaderName: country.countryHeaderName,
      },
    });
  }

  app.post("/api/analytics/track", async (req, res) => {
    try {
      const eventType = req.body?.event;
      const visitorId = normalizeVisitorId(req.body?.visitorId);
      if (!visitorId) {
        return res.status(400).json({ message: "visitorId is required." });
      }
      if (!["page_view", "converter_started", "converter_completed", "converter_failed"].includes(String(eventType))) {
        return res.status(400).json({ message: "Unsupported analytics event." });
      }

      await recordSiteAnalyticsEvent({
        req,
        eventType: eventType as AnalyticsEventType,
        visitorId,
        path: normalizeAnalyticsPath(req.body?.path),
        metadata: sanitizeAnalyticsMetadata(req.body?.metadata),
      });

      return res.status(204).end();
    } catch (error) {
      console.error("[analytics] Tracking failed:", error instanceof Error ? error.message : String(error));
      return res.status(202).end();
    }
  });

  app.get("/api/auth/session", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getPublicSessionStatus(req));
  });

  app.get("/api/auth/institutions", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    try {
      const query = normalizeInstitutionSearchQuery(String(req.query.q ?? ""));
      const institutions = await publicAuthStore.listInstitutions(query);
      return res.json({
        institutions: institutions.map((institution) => ({
          id: institution.id,
          slug: institution.slug,
          name: institution.name,
          domains: institution.domains,
        })),
      });
    } catch (error) {
      return res.status(500).json({
        message: "Could not load institutions.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    let data;
    try {
      data = publicRegistrationRequestSchema.parse(req.body);
    } catch (error) {
      return res.status(400).json({
        message: "Name, email, and password are required.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    if (!isPublicAuthConfigured()) {
      return res.status(503).json({
        message: "Public sign-in is not configured. Set APP_SESSION_SECRET or ADMIN_SESSION_SECRET.",
      });
    }

    const result = await publicAuthStore.createIndividualAccount(data);
    if (!result.ok) {
      return res.status(409).json({
        message: "An account already exists for that email address.",
      });
    }

    clearPublicLoginFailures(req);
    setPublicSessionCookie(req, res, result.account.id);
    return res.status(201).json({
      success: true,
      account: result.account,
    });
  });

  app.post("/api/auth/login", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    let data;
    try {
      data = publicLoginRequestSchema.parse(req.body);
    } catch (error) {
      return res.status(400).json({
        message: "Email and password are required.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    if (!isPublicAuthConfigured()) {
      return res.status(503).json({
        message: "Public sign-in is not configured. Set APP_SESSION_SECRET or ADMIN_SESSION_SECRET.",
      });
    }

    const rateLimit = checkPublicLoginRateLimit(req);
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      return res.status(429).json({
        message: "Too many login attempts. Please try again later.",
      });
    }

    const account = await publicAuthStore.getAccountRecordByEmail(data.email);
    if (!account) {
      recordFailedPublicLogin(req);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    if (account.accountType !== "individual") {
      return res.status(403).json({
        message: "This account belongs to an institution. Use the institutional login page instead.",
      });
    }

    if (!verifyPublicAccountPassword(account, data.password)) {
      recordFailedPublicLogin(req);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    clearPublicLoginFailures(req);
    const sessionAccount = await publicAuthStore.recordSuccessfulLogin(account.id);
    setPublicSessionCookie(req, res, account.id);
    return res.json({
      success: true,
      account: sessionAccount,
    });
  });

  app.post("/api/auth/institutional/register", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    let data;
    try {
      data = institutionalRegistrationRequestSchema.parse(req.body);
    } catch (error) {
      return res.status(400).json({
        message: "Name, institution, work email, and password are required.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    if (!isPublicAuthConfigured()) {
      return res.status(503).json({
        message: "Institutional sign-in is not configured. Set APP_SESSION_SECRET or ADMIN_SESSION_SECRET.",
      });
    }

    const result = await publicAuthStore.createInstitutionalAccount(data);
    if (!result.ok) {
      if (result.reason === "email_exists") {
        return res.status(409).json({ message: "An account already exists for that email address." });
      }
      if (result.reason === "domain_mismatch") {
        return res.status(422).json({ message: "Use an email address from the selected institution domain." });
      }
      return res.status(404).json({ message: "Selected institution could not be found." });
    }

    clearPublicLoginFailures(req);
    setPublicSessionCookie(req, res, result.account.id);
    return res.status(201).json({
      success: true,
      account: result.account,
    });
  });

  app.post("/api/auth/institutional/login", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    let data;
    try {
      data = institutionalLoginRequestSchema.parse(req.body);
    } catch (error) {
      return res.status(400).json({
        message: "Institutional email and password are required.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    if (!isPublicAuthConfigured()) {
      return res.status(503).json({
        message: "Institutional sign-in is not configured. Set APP_SESSION_SECRET or ADMIN_SESSION_SECRET.",
      });
    }

    const rateLimit = checkPublicLoginRateLimit(req);
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      return res.status(429).json({
        message: "Too many login attempts. Please try again later.",
      });
    }

    const account = await publicAuthStore.getAccountRecordByEmail(data.email);
    if (!account) {
      recordFailedPublicLogin(req);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    if (account.accountType !== "institutional") {
      return res.status(403).json({
        message: "This account is not linked to an institution. Use the standard login page instead.",
      });
    }

    if (data.institutionId && account.institutionId !== data.institutionId) {
      return res.status(403).json({
        message: "This account is linked to a different institution.",
      });
    }

    if (!verifyPublicAccountPassword(account, data.password)) {
      recordFailedPublicLogin(req);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    clearPublicLoginFailures(req);
    const sessionAccount = await publicAuthStore.recordSuccessfulLogin(account.id);
    setPublicSessionCookie(req, res, account.id);
    return res.json({
      success: true,
      account: sessionAccount,
    });
  });

  app.post("/api/auth/institutions/request-partnership", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    let data;
    try {
      data = institutionPartnershipRequestSchema.parse(req.body);
    } catch (error) {
      return res.status(400).json({
        message: "Contact name, work email, and institution name are required.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    const result = await publicAuthStore.createPartnershipRequest(data);
    if (!result.ok) {
      return res.status(409).json({
        message: "A partnership request from this email for that institution is already pending review.",
      });
    }

    return res.status(201).json({
      success: true,
      request: result.request,
      message: "Your institutional access request has been saved for review.",
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    clearPublicLoginFailures(req);
    clearPublicSessionCookie(req, res);
    res.json({ success: true });
  });

  app.get("/api/admin/analytics/summary", requireAdmin, async (req, res) => {
    try {
      const requestedDays = Number.parseInt(String(req.query.days ?? "30"), 10);
      const windowDays = Number.isFinite(requestedDays) && requestedDays > 0
        ? Math.min(requestedDays, 365)
        : 30;
      const summary = await getAnalyticsSummary(windowDays);
      return res.json(summary);
    } catch (error) {
      console.error("[analytics] Summary failed:", error instanceof Error ? error.message : String(error));
      return res.status(500).json({ message: "Failed to load analytics summary." });
    }
  });

  app.get("/api/admin/session", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getAdminSessionStatus(req));
  });

  app.post("/api/admin/request-access", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    try {
      const data = adminAccessRequestSchema.parse(req.body);

      if (!isAdminAuthConfigured()) {
        return res.status(503).json({
          message: "Admin access is not configured. Set ADMIN_SESSION_SECRET.",
        });
      }

      const result = await createAdminAccessRequest(data);
      if (!result.ok) {
        const message = result.reason === "approved_exists"
          ? "An approved admin account already exists for that email or username."
          : "An admin request for that email or username is already pending review.";
        return res.status(409).json({ message });
      }

      const approvalUrl = `${getBaseUrl(req)}/adm1n/approve?token=${encodeURIComponent(result.approvalToken)}`;
      const notificationResult = await sendAdminAccessRequestNotification({
        name: data.name,
        username: data.username.trim().toLowerCase(),
        email: data.email.trim().toLowerCase(),
        approvalUrl,
      });

      if (!notificationResult.success) {
        return res.status(502).json({
          message: "The access request was saved, but the approval email could not be delivered.",
        });
      }

      sendAdminAccessRequestAutoReply({
        name: data.name,
        email: data.email.trim().toLowerCase(),
      }).catch((error) => {
        console.error("[admin] Admin access auto-reply failed:", error instanceof Error ? error.message : String(error));
      });

      return res.status(201).json({
        success: true,
        message: "Your admin access request has been sent to support@bulkreferences.com for approval.",
      });
    } catch (error) {
      return res.status(400).json({
        message: "Invalid admin access request.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/admin/login", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    let data;
    try {
      data = adminLoginRequestSchema.parse(req.body);
    } catch (error) {
      return res.status(400).json({
        message: "Email or username and password are required.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    if (!isAdminAuthConfigured()) {
      return res.status(503).json({
        message: "Admin access is not configured. Set ADMIN_SESSION_SECRET.",
      });
    }

    const rateLimit = checkAdminLoginRateLimit(req);
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      return res.status(429).json({
        message: "Too many login attempts. Please try again later.",
      });
    }

    const existingAccount = await findAdminAccountByEmailOrUsername(data.identifier);
    if (existingAccount?.status === "pending") {
      return res.status(403).json({
        message: "This admin account is still pending approval from support@bulkreferences.com.",
      });
    }

    const account = await getApprovedAdminByIdentifier(data.identifier);
    if (!account) {
      recordFailedAdminLogin(req);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    if (!verifyAdminAccountPassword(account, data.password)) {
      recordFailedAdminLogin(req);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    clearAdminLoginFailures(req);
    setAdminSessionCookie(req, res, account.id);
    return res.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
        username: account.username,
        email: account.email,
      },
    });
  });

  app.post("/api/admin/approve", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    try {
      const { token } = adminApprovalSchema.parse(req.body);
      const result = await approveAdminAccessRequest(token);

      if (!result.ok) {
        return res.status(404).json({ message: "Approval link is invalid or no longer matches a pending admin request." });
      }

      return res.json({
        success: true,
        alreadyApproved: result.alreadyApproved,
        account: result.account,
      });
    } catch (error) {
      return res.status(400).json({
        message: "Approval token is required.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    clearAdminLoginFailures(req);
    clearAdminSessionCookie(req, res);
    res.json({ success: true });
  });

  app.use("/api/reports", reportsRouter);
  app.use("/api/history", historyRouter);
  app.use("/api/v2", v2Router);

  // Convert citations endpoint — thin wrapper around engine pipeline
  app.post("/api/convert", async (req, res) => {
    try {
      const validatedData = conversionRequestSchema.parse(req.body);
      const incomingReferences = coerceIncomingReferences(validatedData);
      // v2 callers can opt into authority repair explicitly. The main site does
      // this by default, while tests and internal callers can disable it for
      // deterministic local-only conversion.
      const shouldAttemptValidation = validatedData.enrichWithAuthority;
      const useV2Engine = validatedData.engineVersion !== 'v1';

      if (!useV2Engine) {
        const pipelineResult = await processReferences(incomingReferences, {
          inputStyle: validatedData.inputStyle,
          outputStyle: validatedData.outputStyle,
          enrichWithAuthority: shouldAttemptValidation,
          isPro: true,
        });

        const truthAdjustedStorageData = await Promise.all(
          pipelineResult.storageData.map(async (record) => {
            const adjustedUiData = attachReferencePayloads(
              await applyTruthToLegacyReference(record._uiData, validatedData.outputStyle),
            );
            return {
              ...record,
              parsedData: adjustedUiData.parsedData,
              convertedText: adjustedUiData.convertedText,
              referenceType: adjustedUiData.referenceType,
              confidenceScore: adjustedUiData.confidence?.score ?? record.confidenceScore,
              workKey: adjustedUiData.workKey ?? record.workKey,
              _uiData: adjustedUiData,
            };
          }),
        );

        const storedRefs = await storage.createReferences(
          truthAdjustedStorageData.map(({ _uiData, ...record }) => record)
        );

        const convertResults: ConvertedReference[] = truthAdjustedStorageData.map((record, idx) => attachReferencePayloads({
          ...record._uiData,
          id: storedRefs[idx].id.toString(),
        }));

        const response: ConversionResponse = {
          convertedReferences: convertResults,
          clusters: pipelineResult.clusters,
          duplicateGroups: [],
          engineVersion: 'v1',
          errors: pipelineResult.errors.length > 0 ? pipelineResult.errors : undefined,
        };

        return res.json(response);
      }

      const sourceContent = String(validatedData.content ?? '').trim() || incomingReferences.join("\n\n");
      const { response: v2Response } = await processV2Conversion({
        sourceType: 'text',
        content: sourceContent,
        inputStyle: validatedData.inputStyle,
        outputStyle: validatedData.outputStyle,
        enrich: shouldAttemptValidation,
        dedup: true,
        group: false,
        debug: false,
      }, {
        executionMode: 'sync',
      });

      const legacyRecords = mapV2ResponseToLegacyRecords(v2Response, {
        inputStyle: validatedData.inputStyle,
        outputStyle: validatedData.outputStyle,
      });

      const storedRefs = await storage.createReferences(
        legacyRecords.map((record) => record.storageData)
      );

      const convertResults: ConvertedReference[] = legacyRecords.map((record, idx) => attachReferencePayloads({
        ...record.uiData,
        id: storedRefs[idx].id.toString(),
      }));
      const uiRecordBySourceId = new Map(
        legacyRecords.map((record, idx) => [record.sourceId, convertResults[idx]])
      );
      const duplicateGroups: DuplicateGroup[] = v2Response.citations
        .filter((citation) => citation.status === 'merged' && citation.duplicate?.mergedFrom?.length)
        .map((citation) => {
          const members = (citation.duplicate?.mergedFrom ?? [])
            .map((sourceId) => uiRecordBySourceId.get(sourceId))
            .filter((member): member is ConvertedReference => Boolean(member));
          const primarySourceId =
            v2Response.duplicates.find((entry) => entry.mergedId === citation.id)?.originalId
            ?? citation.duplicate?.mergedFrom?.[0]
            ?? '';
          const primaryId = uiRecordBySourceId.get(primarySourceId)?.id ?? members[0]?.id ?? '';
          return {
            groupId: citation.id,
            primaryId,
            method: citation.duplicate?.method ?? 'structural',
            members,
          };
        })
        .filter((group) => group.members.length > 1 && Boolean(group.primaryId));

      const response: ConversionResponse = {
        convertedReferences: convertResults,
        clusters: undefined,
        duplicateGroups,
        engineVersion: 'v2',
        errors: undefined,
      };

      res.json(response);
    } catch (error) {
      console.error('Validation error:', error instanceof Error ? error.message : String(error));
      res.status(400).json({
        message: "Invalid request data",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Export endpoints
  app.post("/api/export/txt", async (req, res) => {
    try {
      const { references } = req.body;
      if (!Array.isArray(references)) {
        return res.status(400).json({ message: "References array is required" });
      }

      const isIEEE = references[0]?.outputStyle === "ieee";
      const textContent = references.map((ref, index) => {
        let text = ref.convertedText;
        if (isIEEE && /^\[\d+\]\s*/.test(text)) {
          text = text.replace(/^\[\d+\]\s*/, `[${index + 1}] `);
        }
        return text;
      }).join('\n');

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename="references.txt"');
      res.send(textContent);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ message: "Export failed" });
    }
  });

  app.post("/api/export/bibtex", async (req, res) => {
    try {
      const { references } = req.body;
      if (!Array.isArray(references)) {
        return res.status(400).json({ message: "References array is required" });
      }

      // Convert to BibTeX format
      const bibtexContent = references.map((ref, index) => {
        const key = `ref${index + 1} `;
        const type = ref.referenceType === 'journal' ? 'article' :
          ref.referenceType === 'book' ? 'book' : 'misc';

        let bibtex = `@${type} {${key}, \n`;
        if (ref.parsedData.title) bibtex += `  title = {${ref.parsedData.title.replace(/\n/g, ' ').trim()}}, \n`;
        if (ref.parsedData.authors) bibtex += `  author = { ${ref.parsedData.authors.join(' and ')}}, \n`;
        if (ref.parsedData.year) bibtex += `  year = { ${ref.parsedData.year}}, \n`;
        if (ref.parsedData.journal) bibtex += `  journal = { ${ref.parsedData.journal}}, \n`;
        if (ref.parsedData.volume) bibtex += `  volume = { ${ref.parsedData.volume}}, \n`;
        if (ref.parsedData.issue) bibtex += `  number = { ${ref.parsedData.issue}}, \n`;
        if (ref.parsedData.pages) bibtex += `  pages = { ${ref.parsedData.pages}}, \n`;
        if (ref.parsedData.publisher) bibtex += `  publisher = { ${ref.parsedData.publisher}}, \n`;
        if (ref.parsedData.doi) bibtex += `  doi = { ${ref.parsedData.doi}}, \n`;
        bibtex += '}';

        return bibtex;
      }).join('\n\n');

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename="references.bib"');
      res.send(bibtexContent);
    } catch (error) {
      console.error('BibTeX export error:', error);
      res.status(500).json({ message: "BibTeX export failed" });
    }
  });

  app.post("/api/export/ris", async (req, res) => {
    try {
      const { references } = req.body;
      if (!Array.isArray(references)) {
        return res.status(400).json({ message: "References array is required" });
      }

      const risLines: string[] = [];
      for (let i = 0; i < references.length; i++) {
        const ref = references[i];
        const p = ref.parsedData || {};
        const type = ref.referenceType === "journal" ? "JOUR" :
          ref.referenceType === "book" ? "BOOK" :
            ref.referenceType === "conference" ? "CONF" : "JOUR";

        risLines.push(`TY  - ${type}`);
        if (p.authors && Array.isArray(p.authors)) {
          for (const a of p.authors) risLines.push(`AU  - ${a}`);
        } else if (p.authors) risLines.push(`AU  - ${p.authors}`);
        if (p.title) risLines.push(`TI  - ${p.title}`);
        if (p.journal) risLines.push(`JO  - ${p.journal}`);
        if (p.conferenceTitle) risLines.push(`T2  - ${p.conferenceTitle}`);
        if (p.bookTitle) risLines.push(`BT  - ${p.bookTitle}`);
        if (p.volume) risLines.push(`VL  - ${p.volume}`);
        if (p.issue) risLines.push(`IS  - ${p.issue}`);
        if (p.pages) {
          const m = p.pages.match(/^(\d+)[–-](\d+)$/);
          if (m) {
            risLines.push(`SP  - ${m[1]}`);
            risLines.push(`EP  - ${m[2]}`);
          } else risLines.push(`SP  - ${p.pages}`);
        }
        if ((p as any)['article-number']) risLines.push(`AN  - ${(p as any)['article-number']}`);
        if (p.year) risLines.push(`PY  - ${p.year}`);
        if (p.publisher) risLines.push(`PB  - ${p.publisher}`);
        if (p.doi) risLines.push(`DO  - ${p.doi}`);
        if (p.url) risLines.push(`UR  - ${p.url}`);
        risLines.push("ER  - ");
        risLines.push("");
      }

      const risContent = risLines.join("\n").trimEnd();
      res.setHeader('Content-Type', 'application/x-research-info-systems');
      res.setHeader('Content-Disposition', 'attachment; filename="references.ris"');
      res.send(risContent);
    } catch (error) {
      console.error('RIS export error:', error);
      res.status(500).json({ message: "RIS export failed" });
    }
  });

  // Recheck authority for a single reference (Pro; optionally bypass cache)
  app.post("/api/recheck", async (req, res) => {
    try {
      const { referenceId, force } = req.body as { referenceId?: string; workKey?: string; force?: boolean };
      const id = referenceId != null ? parseInt(String(referenceId), 10) : NaN;
      if (isNaN(id) || id < 1) {
        return res.status(400).json({ message: "referenceId (number) is required" });
      }
      const ref = await storage.getReference(id);
      if (!ref?.parsedData) {
        return res.status(404).json({ message: "Reference not found" });
      }
      const result = await getAuthorityData(ref.parsedData, { force: !!force });
      const authorityData = result.data ?? undefined;
      const authorityStatus = result.status;
      const confidence = getStableConfidenceForStoredReference(ref);
      res.json({ authorityData, authorityStatus, confidence });
    } catch (error) {
      console.error("Recheck error:", error);
      res.status(500).json({
        message: "Recheck failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // File parsing endpoint
  app.post("/api/parse-file", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const file = req.file;
      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      const mime = file.mimetype || '';
      let text = '';

      const isTxt = mime === 'text/plain' || ext === '.txt';
      const isPdf = mime === 'application/pdf' || ext === '.pdf';
      const isDocx =
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === '.docx';

      if (isTxt) {
        text = file.buffer.toString('utf-8');
      } else if (isPdf) {
        const pdfData = await pdfParse(file.buffer);
        text = (pdfData && pdfData.text) ? pdfData.text : '';
      } else if (isDocx) {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        text = (result && result.value) ? result.value : '';
      } else {
        return res.status(400).json({
          error: 'File type not supported. Please upload a .txt, .pdf, or .docx file.'
        });
      }

      res.json({ text: (text || '').trim() });
    } catch (error) {
      console.error('File parsing error:', error);
      res.status(500).json({
        error: 'Failed to parse file',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Reformat endpoint: thin wrapper around engine pipeline
  app.post("/api/reformat", async (req, res) => {
    try {
      const { references, outputStyle } = req.body as {
        references: Array<{ id: string; parsedData: any; referenceType: string; originalText: string; inputStyle: string }>;
        outputStyle: string;
      };
      if (!Array.isArray(references) || !outputStyle) {
        return res.status(400).json({ message: "references[] and outputStyle are required" });
      }

      const reformatResults = reformatReferences(references, outputStyle);
      res.json({ convertedReferences: reformatResults });
    } catch (error) {
      console.error('Reformat error:', error);
      res.status(500).json({ message: "Reformat failed" });
    }
  });

  // Contact/Feedback endpoint
  app.post("/api/contact", async (req, res) => {
    try {
      const { name, email, subject, message } = contactRequestSchema.parse(req.body);

      console.log(`[ContactForm] New message from ${name} (${email}) - [${subject}]`);
      console.log(`Message: ${message}`);

      const notificationResult = await sendContactNotification({ name, email, subject, message });

      if (!notificationResult.success) {
        console.error("[routes] Contact notification failed:", notificationResult.error ?? "Unknown email error");
        return res.status(502).json({
          message: "Message could not be delivered",
          error: notificationResult.error ?? "Email provider rejected the request",
        });
      }

      sendContactAutoReply({ name, email, subject }).catch((err) => {
        console.error("[routes] Contact auto-reply failed:", err instanceof Error ? err.message : String(err));
      });

      res.json({ success: true, message: "Your message has been received." });
    } catch (error) {
      console.error('Contact error:', error);
      res.status(400).json({
        message: "Invalid contact form data",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/waitlist", async (req, res) => {
    try {
      const { email, persona } = waitlistRequestSchema.parse(req.body);

      const notificationResult = await sendWaitlistNotification({ email, persona });

      if (!notificationResult.success) {
        console.error("[routes] Waitlist notification failed:", notificationResult.error ?? "Unknown email error");
        return res.status(502).json({
          message: "Waitlist signup could not be delivered",
          error: notificationResult.error ?? "Email provider rejected the request",
        });
      }

      sendWaitlistAutoReply({ email, persona }).catch((err) => {
        console.error("[routes] Waitlist auto-reply failed:", err instanceof Error ? err.message : String(err));
      });

      res.json({ success: true, message: "You've been added to the waitlist." });
    } catch (error) {
      console.error("Waitlist error:", error);
      res.status(400).json({
        message: "Invalid waitlist form data",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

/**
 * shared/schema/validation.ts
 *
 * Zod validation schemas and style normalization utility.
 */

import { z } from 'zod';
import type { CitationStyle } from './types';

/** UI/API may send 'harvard' or 'chicago'; normalize to internal style for CSL and strict renderer. */
export function normalizeCitationStyle(style: string): CitationStyle {
  const s = (style || '').toLowerCase().trim();
  if (s === 'harvard') return 'harvard-ctr';
  if (s === 'chicago') return 'chicago-ad';
  if (['apa', 'mla', 'harvard-ctr', 'chicago-ad', 'chicago-nb', 'ieee', 'vancouver', 'auto'].includes(s)) {
    return s as CitationStyle;
  }
  return 'apa';
}

// Validation schemas
export const conversionRequestSchema = z.object({
  references: z.array(z.string().min(1)).optional(),
  content: z.string().min(1).optional(),
  inputStyle: z.string(),
  outputStyle: z.string(),
  enrichWithAuthority: z.boolean().optional().default(false),
  isPro: z.boolean().optional().default(false),
  engineVersion: z.enum(['v1', 'v2']).optional(),
}).superRefine((value, ctx) => {
  const hasReferences = Array.isArray(value.references) && value.references.some((reference) => reference.trim().length > 0);
  const hasContent = typeof value.content === 'string' && value.content.trim().length > 0;

  if (hasReferences || hasContent) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'Either references or content must be provided.',
    path: ['references'],
  });
});

/** ── Contact & Feedback ── */

export const contactRequestSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email address"),
  subject: z.enum(["feature", "recommendation", "bug", "contact"]),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

export type ContactRequest = z.infer<typeof contactRequestSchema>;

export const waitlistRequestSchema = z.object({
  email: z.string().email("Invalid email address"),
  persona: z.enum(["student", "researcher", "educator", "developer", "team"]),
});

export type WaitlistRequest = z.infer<typeof waitlistRequestSchema>;

export const publicRegistrationRequestSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80, "Name is too long"),
  email: z.string().trim().email("A valid email is required"),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

export type PublicRegistrationRequest = z.infer<typeof publicRegistrationRequestSchema>;

export const publicLoginRequestSchema = z.object({
  email: z.string().trim().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});

export type PublicLoginRequest = z.infer<typeof publicLoginRequestSchema>;

export const institutionalRegistrationRequestSchema = publicRegistrationRequestSchema.extend({
  institutionId: z.string().trim().min(2, "Institution is required"),
});

export type InstitutionalRegistrationRequest = z.infer<typeof institutionalRegistrationRequestSchema>;

export const institutionalLoginRequestSchema = publicLoginRequestSchema.extend({
  institutionId: z.string().trim().min(2).optional(),
});

export type InstitutionalLoginRequest = z.infer<typeof institutionalLoginRequestSchema>;

export const userHistoryItemSchema = z.object({
  id: z.string().trim().min(1).max(160),
  originalText: z.string().trim().min(1).max(10000),
  convertedText: z.string().trim().min(1).max(10000),
  inputStyle: z.string().trim().min(1).max(80),
  outputStyle: z.string().trim().min(1).max(80),
  healthState: z.string().trim().min(1).max(40).optional(),
  timestamp: z.string().trim().min(1).max(80),
  customName: z.string().trim().max(160).optional(),
});

export type UserHistoryItem = z.infer<typeof userHistoryItemSchema>;

export const userHistorySnapshotSchema = z.object({
  clientId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,80}$/),
  items: z.array(userHistoryItemSchema).max(5000),
});

export type UserHistorySnapshot = z.infer<typeof userHistorySnapshotSchema>;

export const institutionPartnershipRequestSchema = z.object({
  contactName: z.string().trim().min(2, "Contact name is required").max(80, "Contact name is too long"),
  workEmail: z.string().trim().email("A valid work email is required"),
  institutionName: z.string().trim().min(2, "Institution name is required").max(140, "Institution name is too long"),
  notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer").optional().default(""),
});

export type InstitutionPartnershipRequest = z.infer<typeof institutionPartnershipRequestSchema>;

export const adminAccessRequestSchema = z.object({
  name: z.string().trim().min(2, "Full name is required").max(80, "Name is too long"),
  username: z.string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be 32 characters or fewer")
    .regex(/^[a-zA-Z0-9._-]+$/, "Username can use letters, numbers, dots, dashes, and underscores"),
  email: z.string().trim().email("A valid work email is required"),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

export type AdminAccessRequest = z.infer<typeof adminAccessRequestSchema>;

export const adminLoginRequestSchema = z.object({
  identifier: z.string().trim().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const adminApprovalSchema = z.object({
  token: z.string().trim().min(20, "Approval token is required"),
});

export type AdminApprovalRequest = z.infer<typeof adminApprovalSchema>;

export const v2ConversionRequestSchema = z.object({
  sourceType: z.enum(['text', 'bib', 'ris', 'pdf_base64', 'url', 'doi_list']),
  content: z.string().min(1),
  inputStyle: z.string().optional().default('auto'),
  outputStyle: z.string().optional().default('apa'),
  enrich: z.boolean().optional().default(true),
  dedup: z.boolean().optional().default(true),
  group: z.boolean().optional().default(false),
  debug: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type V2ConversionRequest = z.infer<typeof v2ConversionRequestSchema>;

export const v2ExportFormatSchema = z.enum(['txt', 'bib', 'ris', 'csv', 'docx']);
export type V2ExportFormat = z.infer<typeof v2ExportFormatSchema>;

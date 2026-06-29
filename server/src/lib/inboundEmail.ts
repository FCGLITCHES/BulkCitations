import { env } from '../config.js';
import { instrumentedFetch, mapOutboundFetchError } from '../services/instrumentedFetch.js';

interface SendInboundEmailOptions {
  html: string;
  replyTo?: string | null;
  subject: string;
}

export function canSendInboundEmail() {
  return Boolean(env.RESEND_API_KEY?.trim() && env.CONTACT_EMAIL_TO?.trim());
}

export async function sendInboundEmail(options: SendInboundEmailOptions) {
  if (!canSendInboundEmail()) {
    return { configured: false as const, ok: false as const };
  }

  let response: Response;
  try {
    response = await instrumentedFetch({
      provider: 'other',
      route: '/resend/emails',
      method: 'POST',
      url: 'https://api.resend.com/emails',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: {
        from: env.RESEND_FROM_EMAIL?.trim() || 'BulkReferences <onboarding@resend.dev>',
        to: [env.CONTACT_EMAIL_TO!.trim()],
        ...(options.replyTo?.trim() ? { reply_to: options.replyTo.trim() } : {}),
        subject: options.subject,
        html: options.html,
      },
      expectedContentTypes: ['application/json'],
    });
  } catch (error) {
    const mapped = mapOutboundFetchError(
      error,
      'Resend delivery service is unavailable.',
    );
    throw new Error(`${mapped.code} (${mapped.statusCode}): ${mapped.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Resend API error (${response.status}): ${errorText}`.trim());
  }

  return { configured: true as const, ok: true as const };
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

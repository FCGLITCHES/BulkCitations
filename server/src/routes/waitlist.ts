import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAuditEvent } from '../audit/recordAudit.js';
import { getCorrelationId } from '../runtime/requestContext.js';
import { canSendInboundEmail, escapeHtml, sendInboundEmail } from '../lib/inboundEmail.js';

const waitlistBodySchema = z.object({
  email: z.string().trim().email(),
  persona: z.enum(['student', 'researcher', 'educator', 'developer', 'team']),
});

export async function waitlistRoute(app: FastifyInstance): Promise<void> {
  app.post('/waitlist', async (req, reply) => {
    const parsed = waitlistBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid waitlist request payload.',
      });
    }

    const { email, persona } = parsed.data;

    await recordAuditEvent({
      action: 'marketing.waitlist_signup',
      resource: 'waitlist/signup',
      correlationId: getCorrelationId(),
      statusCode: 200,
      metadata: {
        email: email.toLowerCase(),
        persona,
      },
    });

    if (canSendInboundEmail()) {
      try {
        await sendInboundEmail({
          replyTo: email,
          subject: `[BulkReferences] Waitlist signup — ${persona}`,
          html: [
            `<p><strong>Email:</strong> ${escapeHtml(email)}</p>`,
            `<p><strong>Persona:</strong> ${escapeHtml(persona)}</p>`,
            `<p><strong>Correlation ID:</strong> ${escapeHtml(getCorrelationId() ?? 'unknown')}</p>`,
          ].join('\n'),
        });
      } catch (error) {
        req.log.warn(
          { error: error instanceof Error ? error.message : String(error), correlationId: getCorrelationId() },
          'waitlist signup delivery failed',
        );
        return reply.status(502).send({
          message: 'Your waitlist signup was recorded, but delivery failed. Please try again shortly.',
        });
      }
    }

    return reply.status(200).send({
      ok: true,
      message: canSendInboundEmail()
        ? 'You are on the waitlist. We will keep you posted by email.'
        : 'You are on the waitlist. Your signup has been recorded.',
    });
  });
}

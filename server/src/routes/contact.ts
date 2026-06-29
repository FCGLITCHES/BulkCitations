import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { canSendInboundEmail, escapeHtml, sendInboundEmail } from '../lib/inboundEmail.js';

const bodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  subject: z.enum(['feature', 'recommendation', 'bug', 'contact']),
  message: z.string().trim().min(10).max(8000),
});

export async function contactRoute(app: FastifyInstance): Promise<void> {
  app.post('/contact', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Contact form payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    if (!canSendInboundEmail()) {
      return reply.status(503).send({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Contact email is not configured on this server.',
      });
    }

    const { name, email, subject, message } = parsed.data;
    const subjectLabels: Record<typeof subject, string> = {
      feature: 'Feature request',
      recommendation: 'Recommendation',
      bug: 'Bug report',
      contact: 'General contact',
    };

    try {
      await sendInboundEmail({
        replyTo: email,
        subject: `[BulkReferences] ${subjectLabels[subject]} — ${name}`,
        html: [
          `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>`,
          `<p><strong>Topic:</strong> ${escapeHtml(subjectLabels[subject])}</p>`,
          `<hr />`,
          `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(message)}</pre>`,
        ].join('\n'),
      });
    } catch (error) {
      req.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Resend API error',
      );
      throw new AppError(502, ErrorCode.INTERNAL_ERROR, 'Could not send message. Please try again later.');
    }

    return reply.status(200).send({ ok: true });
  });
}

import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Raw UTF-8 body for webhook signature verification (bytes must match the provider). */
    rawBody?: string;
  }
}

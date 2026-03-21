import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => {
  return {
    Resend: class {
      emails = {
        send: mockSend,
      };
    },
  };
});

describe('contact email reply-to handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-api-key';
    delete process.env.CONTACT_EMAIL_FROM;
    mockSend.mockResolvedValue({
      data: { id: 'email_123' },
      error: null,
    });
  });

  it('sends support notifications with the user as Reply-To', async () => {
    const { sendContactNotification } = await import('./email.js');

    const result = await sendContactNotification({
      name: 'Jane Doe',
      email: 'jane@example.com',
      subject: 'bug',
      message: 'The converter is not saving my changes.',
    });

    expect(result).toEqual({ success: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Bulk References <support@bulkreferences.com>',
      to: 'support@bulkreferences.com',
      subject: '[Bulk References Contact] bug: from Jane Doe',
      replyTo: '"Jane Doe" <jane@example.com>',
      headers: {
        'Reply-To': '"Jane Doe" <jane@example.com>',
        'X-Reply-To': '"Jane Doe" <jane@example.com>',
      },
    }));
  });

  it('does not attach Reply-To headers to auto-replies', async () => {
    const { sendContactAutoReply } = await import('./email.js');

    const result = await sendContactAutoReply({
      name: 'Jane Doe',
      email: 'jane@example.com',
      subject: 'feature',
    });

    expect(result).toEqual({ success: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      to: 'jane@example.com',
      subject: 'We received your Bulk References message',
      replyTo: undefined,
      headers: undefined,
    }));
  });
});

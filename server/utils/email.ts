import { Resend } from 'resend';

// Configure Resend with API key from environment
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = "Citing <notifications@citing.app>"; // Must be a verified domain in Resend
const TO_EMAIL = process.env.CONTACT_EMAIL_TO || "youben2025@gmail.com";

/**
 * Send a notification email when the contact form is submitted.
 * 
 * @param data — { name, email, subject, message }
 * @returns { success, error? }
 */
export async function sendContactNotification(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
}): Promise<{ success: boolean; error?: string }> {
    if (!resend) {
        console.warn("[email] Resend API key missing; skipping actual email send.");
        return { success: true }; // Return success so UI doesn't show error, just won't send email
    }

    try {
        const { data: resendData, error } = await resend.emails.send({
            from: FROM_EMAIL,
            to: TO_EMAIL,
            subject: `[Citing Contact] ${data.subject}: from ${data.name}`,
            replyTo: data.email,
            html: `
                <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #6366f1; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px;">New Contact Message</h2>
                    <p><strong>From:</strong> ${data.name} (&lt;${data.email}&gt;)</p>
                    <p><strong>Subject:</strong> ${data.subject}</p>
                    <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; margin-top: 20px;">
                        <p style="white-space: pre-wrap;">${data.message}</p>
                    </div>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0 20px 0;" />
                    <p style="font-size: 12px; color: #9ca3af; text-align: center;">Sent from Citing App contact form.</p>
                </div>
            `,
        });

        if (error) {
            console.error("[email] Resend API error:", error.message || String(error));
            return { success: false, error: error.message };
        }

        console.log(`[email] Notification sent: ${resendData?.id}`);
        return { success: true };
    } catch (err) {
        console.error("[email] Unexpected error sending email:", err instanceof Error ? err.message : String(err));
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
}

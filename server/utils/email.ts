import { Resend } from 'resend';

// Configure Resend with API key from environment
const STATIC_TO_EMAIL = "support@bulkreferences.com";

/**
 * Send a notification email when the contact form is submitted.
 */
export async function sendContactNotification(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
}): Promise<{ success: boolean; error?: string }> {
    const apiKey = process.env.RESEND_API_KEY;
    const toEmail = process.env.CONTACT_EMAIL_TO || STATIC_TO_EMAIL;

    // Fallback 'from' email — requires domain verification in Resend dashboard.
    // User verified domain: bulkreferences.com
    const fromEmail = process.env.CONTACT_EMAIL_FROM || "Citing <support@bulkreferences.com>"; 

    if (!apiKey) {
        console.error("[email] CRITICAL: RESEND_API_KEY is missing from environment. Double check Vercel settings.");
        return { success: false, error: "API key missing" };
    }

    try {
        const resend = new Resend(apiKey);
        console.log(`[email] DEBUG: Starting send process...`);
        console.log(`[email] From: ${fromEmail}`);
        console.log(`[email] To: ${toEmail}`);
        console.log(`[email] Subject: [Citing Contact] ${data.subject}`);

        const emailResult = await resend.emails.send({
            from: fromEmail,
            to: toEmail,
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

        if (emailResult.error) {
            console.error("[email] Resend API rejected the request:");
            console.error(`  - Name: ${emailResult.error.name}`);
            console.error(`  - Message: ${emailResult.error.message}`);
            // This is the most important part for DNS/Verification issues
            console.error(`  - Full Error Trace: ${JSON.stringify(emailResult.error)}`); 
            return { success: false, error: emailResult.error.message };
        }

        console.log(`[email] SUCCESS! Notification ID: ${emailResult.data?.id}`);
        return { success: true };
    } catch (err) {
        console.error("[email] SYSTEM EXCEPTION during send (Networking/Runtime):", err instanceof Error ? err.message : String(err));
        return { success: false, error: err instanceof Error ? err.message : "Internal error" };
    }
}

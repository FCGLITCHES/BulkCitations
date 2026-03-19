import { Resend } from 'resend';

// Configure Resend with API key from environment
const STATIC_TO_EMAIL = "support@bulkreferences.com";

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatMessage(message: string) {
    return escapeHtml(message).replace(/\r?\n/g, "<br />");
}

function buildContactEmailHtml(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
}) {
    const safeName = escapeHtml(data.name);
    const safeEmail = escapeHtml(data.email);
    const safeSubject = escapeHtml(data.subject);
    const safeMessage = formatMessage(data.message);

    return `
        <div style="margin:0;padding:32px 16px;background-color:#f4f7fb;">
            <div style="max-width:640px;margin:0 auto;font-family:Sohne,Inter,'Segoe UI',Arial,sans-serif;color:#0f172a;">
                <div style="overflow:hidden;border-radius:24px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#10b981 100%);padding:32px 32px 28px;box-shadow:0 24px 60px rgba(15,23,42,0.18);">
                    <div style="display:inline-block;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.1);color:#ecfdf5;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                        New Contact Message
                    </div>
                    <h1 style="margin:18px 0 10px;font-size:32px;line-height:1.1;font-weight:800;color:#ffffff;">
                        Citing inbox update
                    </h1>
                    <p style="margin:0;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.78);max-width:440px;">
                        A new contact request just came in from the website. The details below follow the same clean card-and-gradient styling used across Citing.
                    </p>
                </div>

                <div style="margin-top:-18px;padding:0 14px;">
                    <div style="background:#ffffff;border:1px solid #dbe4ee;border-radius:22px;padding:28px;box-shadow:0 18px 45px rgba(15,23,42,0.08);">
                        <div style="display:grid;grid-template-columns:1fr;gap:14px;">
                            <div style="border:1px solid #e2e8f0;border-radius:16px;padding:16px 18px;background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);">
                                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:#64748b;margin-bottom:6px;">From</div>
                                <div style="font-size:18px;font-weight:700;color:#0f172a;">${safeName}</div>
                                <div style="font-size:14px;color:#475569;margin-top:4px;">${safeEmail}</div>
                            </div>

                            <div style="border:1px solid #d1fae5;border-radius:16px;padding:16px 18px;background:linear-gradient(180deg,rgba(16,185,129,0.10) 0%,rgba(255,255,255,0.96) 100%);">
                                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:#059669;margin-bottom:6px;">Topic</div>
                                <div style="font-size:18px;font-weight:700;color:#064e3b;">${safeSubject}</div>
                            </div>

                            <div style="border:1px solid #e2e8f0;border-radius:18px;padding:20px;background:#f8fafc;">
                                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:#64748b;margin-bottom:12px;">Message</div>
                                <div style="font-size:15px;line-height:1.8;color:#1e293b;">${safeMessage}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="padding:18px 8px 0;text-align:center;">
                    <p style="margin:0;font-size:12px;line-height:1.7;color:#64748b;">
                        Sent from the Citing contact form.
                    </p>
                </div>
            </div>
        </div>
    `;
}

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
        console.warn("[email] RESEND_API_KEY is missing. Add it to Vercel/Environment variables.");
        return { success: false, error: "API key missing" };
    }

    try {
        const resend = new Resend(apiKey);
        console.log(`[email] Attempting to send from ${fromEmail} to ${toEmail}...`);

        const emailResult = await resend.emails.send({
            from: fromEmail,
            to: toEmail,
            subject: `[Citing Contact] ${data.subject}: from ${data.name}`,
            replyTo: data.email,
            html: buildContactEmailHtml(data),
        });

        if (emailResult.error) {
            console.error("[email] Resend API error:", emailResult.error.message || String(emailResult.error));
            console.error("[email] Full error details:", JSON.stringify(emailResult.error));
            return { success: false, error: emailResult.error.message };
        }

        console.log(`[email] Notification successfully sent. ID: ${emailResult.data?.id}`);
        return { success: true };
    } catch (err) {
        console.error("[email] Exception during email send:", err instanceof Error ? err.message : String(err));
        return { success: false, error: err instanceof Error ? err.message : "Internal error" };
    }
}

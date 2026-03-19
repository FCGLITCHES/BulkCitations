import { Resend } from 'resend';

const STATIC_TO_EMAIL = "support@bulkreferences.com";
const DEFAULT_FROM_EMAIL = "Bulk References <support@bulkreferences.com>";
const APP_NAME = "Bulk References";
const APP_URL = "https://bulkreferences.com";

type SendEmailResult = { success: boolean; error?: string };

type TemplateOptions = {
    badge: string;
    title: string;
    description: string;
    sections: string;
    footer?: string;
};

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

function buildInfoCard(label: string, value: string, accent = false) {
    const border = accent ? "#d1fae5" : "#e2e8f0";
    const background = accent
        ? "linear-gradient(180deg,rgba(16,185,129,0.10) 0%,rgba(255,255,255,0.96) 100%)"
        : "linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)";
    const labelColor = accent ? "#059669" : "#64748b";
    const valueColor = accent ? "#064e3b" : "#0f172a";

    return `
        <div style="border:1px solid ${border};border-radius:18px;padding:18px 18px;background:${background};">
            <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:${labelColor};margin-bottom:8px;">${escapeHtml(label)}</div>
            <div style="font-size:18px;font-weight:700;color:${valueColor};line-height:1.5;">${value}</div>
        </div>
    `;
}

function buildMessageCard(label: string, messageHtml: string) {
    return `
        <div style="border:1px solid #e2e8f0;border-radius:18px;padding:18px 18px;background:#f8fafc;">
            <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:#64748b;margin-bottom:8px;">${escapeHtml(label)}</div>
            <div style="font-size:15px;line-height:1.8;color:#1e293b;">${messageHtml}</div>
        </div>
    `;
}

function buildCtaButton(label: string, href: string) {
    const safeLabel = escapeHtml(label);
    const safeHref = escapeHtml(href);

    return `
        <div style="margin-top:22px;">
            <a href="${safeHref}" style="display:inline-block;background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#10b981 100%);color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-size:14px;font-weight:700;letter-spacing:0.01em;">
                ${safeLabel}
            </a>
        </div>
    `;
}

function buildEmailShell(options: TemplateOptions) {
    const footer = options.footer ?? `Sent from the ${APP_NAME} email system.`;

    return `
        <div style="margin:0;padding:32px 16px;background-color:#f4f7fb;">
            <div style="max-width:640px;margin:0 auto;font-family:Sohne,Inter,'Segoe UI',Arial,sans-serif;color:#0f172a;">
                <div style="overflow:hidden;border-radius:24px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#10b981 100%);padding:32px 32px 28px;box-shadow:0 24px 60px rgba(15,23,42,0.18);">
                    <div style="display:inline-block;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.1);color:#ecfdf5;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                        ${escapeHtml(options.badge)}
                    </div>
                    <h1 style="margin:18px 0 10px;font-size:32px;line-height:1.1;font-weight:800;color:#ffffff;">
                        ${escapeHtml(options.title)}
                    </h1>
                    <p style="margin:0;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.78);max-width:460px;">
                        ${escapeHtml(options.description)}
                    </p>
                </div>

                <div style="margin-top:-18px;padding:0 14px;">
                    <div style="background:#ffffff;border:1px solid #dbe4ee;border-radius:22px;padding:28px;box-shadow:0 18px 45px rgba(15,23,42,0.08);">
                        <div style="display:grid;grid-template-columns:1fr;gap:16px;">
                            ${options.sections}
                        </div>
                    </div>
                </div>

                <div style="padding:18px 8px 0;text-align:center;">
                    <p style="margin:0;font-size:12px;line-height:1.7;color:#64748b;">
                        ${escapeHtml(footer)}
                    </p>
                </div>
            </div>
        </div>
    `;
}

export function buildContactNotificationEmailHtml(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
}) {
    const safeName = escapeHtml(data.name);
    const safeEmail = escapeHtml(data.email);
    const safeSubject = escapeHtml(data.subject);
    const safeMessage = formatMessage(data.message);

    return buildEmailShell({
        badge: "New Contact Message",
        title: "Bulk References inbox update",
        description: "A new contact request just came in from the website. The details below use the same clean card-and-gradient styling as the product.",
        sections: `
            ${buildInfoCard("From", `${safeName}<div style="font-size:14px;color:#475569;margin-top:4px;font-weight:500;">${safeEmail}</div>`)}
            ${buildInfoCard("Topic", safeSubject, true)}
            ${buildMessageCard("Message", safeMessage)}
        `,
        footer: "Sent from the Bulk References contact form.",
    });
}

export function buildContactAutoReplyEmailHtml(data: {
    name: string;
    subject: string;
}) {
    const safeName = escapeHtml(data.name);
    const safeSubject = escapeHtml(data.subject);

    return buildEmailShell({
        badge: "Message Received",
        title: "We got your note",
        description: "Thanks for reaching out to Bulk References. Your message is in our inbox and we will review it shortly.",
        sections: `
            ${buildInfoCard("From", safeName)}
            ${buildInfoCard("Topic", safeSubject, true)}
            ${buildMessageCard("What happens next", `
                We will review your message and follow up if needed.<br />
                If your note was about a bug or feature request, it is now part of our review queue.
            `)}
            ${buildMessageCard("Need to add details?", `
                Reply directly to this email and your response will stay attached to the same conversation.
                ${buildCtaButton("Open Bulk References", APP_URL)}
            `)}
        `,
        footer: "This is an automatic confirmation from Bulk References.",
    });
}

export function buildPasswordResetEmailHtml(data: {
    name?: string;
    resetUrl: string;
    expiresInHours?: number;
}) {
    const safeName = data.name ? escapeHtml(data.name) : "there";
    const expiresInHours = data.expiresInHours ?? 1;
    const safeResetUrl = escapeHtml(data.resetUrl);

    return buildEmailShell({
        badge: "Password Reset",
        title: "Reset your password",
        description: `Hi ${safeName}, we received a request to reset your ${APP_NAME} password.`,
        sections: `
            ${buildMessageCard("Secure access", `
                Use the button below to set a new password. This reset link expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"}.
                ${buildCtaButton("Reset password", safeResetUrl)}
            `)}
            ${buildMessageCard("Did not request this?", `
                If you did not request a password reset, you can safely ignore this email. Your account remains unchanged until the reset link is used.
            `)}
        `,
        footer: "Security notification from Bulk References.",
    });
}

export function buildEmailVerificationEmailHtml(data: {
    name?: string;
    verificationUrl: string;
    expiresInHours?: number;
}) {
    const safeName = data.name ? escapeHtml(data.name) : "there";
    const expiresInHours = data.expiresInHours ?? 24;
    const safeVerificationUrl = escapeHtml(data.verificationUrl);

    return buildEmailShell({
        badge: "Verify Email",
        title: "Confirm your email address",
        description: `Hi ${safeName}, finish setting up your ${APP_NAME} account by verifying your email address.`,
        sections: `
            ${buildMessageCard("Verification", `
                Click below to confirm your email. This link expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"}.
                ${buildCtaButton("Verify email", safeVerificationUrl)}
            `)}
            ${buildMessageCard("Why this matters", `
                Email verification helps us secure your account and make sure important product updates reach the right inbox.
            `)}
        `,
        footer: "Account verification email from Bulk References.",
    });
}

async function sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
}): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.CONTACT_EMAIL_FROM || DEFAULT_FROM_EMAIL;

    if (!apiKey) {
        console.warn("[email] RESEND_API_KEY is missing. Add it to Vercel/Environment variables.");
        return { success: false, error: "API key missing" };
    }

    try {
        const resend = new Resend(apiKey);
        console.log(`[email] Attempting to send from ${fromEmail} to ${params.to}...`);

        const emailResult = await resend.emails.send({
            from: fromEmail,
            to: params.to,
            subject: params.subject,
            replyTo: params.replyTo,
            html: params.html,
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

export async function sendContactNotification(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
}): Promise<SendEmailResult> {
    return sendEmail({
        to: STATIC_TO_EMAIL,
        subject: `[Bulk References Contact] ${data.subject}: from ${data.name}`,
        replyTo: data.email,
        html: buildContactNotificationEmailHtml(data),
    });
}

export async function sendContactAutoReply(data: {
    name: string;
    email: string;
    subject: string;
}): Promise<SendEmailResult> {
    return sendEmail({
        to: data.email,
        subject: `We received your ${APP_NAME} message`,
        html: buildContactAutoReplyEmailHtml(data),
    });
}

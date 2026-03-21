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

function sanitizeHeaderValue(value: string) {
    return value.replace(/[\r\n]+/g, " ").trim();
}

function formatMailbox(name: string | undefined, email: string) {
    const safeEmail = sanitizeHeaderValue(email);
    const safeName = sanitizeHeaderValue(name ?? "");

    if (!safeName) {
        return safeEmail;
    }

    const quotedName = safeName.replace(/"/g, '\\"');
    return `"${quotedName}" <${safeEmail}>`;
}

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

function buildCtaButton(label: string, href: string) {
    const safeLabel = escapeHtml(label);
    const safeHref = escapeHtml(href);

    return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
            <tr>
                <td style="background-color:#0f172a;padding:0;">
                    <a href="${safeHref}" style="display:inline-block;background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#10b981 100%);color:#ffffff;text-decoration:none;padding:14px 22px;font-size:14px;font-weight:700;letter-spacing:0.01em;">
                ${safeLabel}
            </a>
                </td>
            </tr>
        </table>
    `;
}

function buildSectionRow(label: string, valueHtml: string, accent = false) {
    const headerColor = accent ? "#047857" : "#64748b";
    const valueColor = accent ? "#064e3b" : "#0f172a";
    const borderColor = accent ? "#c7f0df" : "#dbe4ee";
    const backgroundColor = accent ? "#f2fbf7" : "#ffffff";

    return `
        <tr>
            <td style="border:1px solid ${borderColor};background-color:${backgroundColor};padding:18px 20px;">
                <div style="font-size:12px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:${headerColor};margin:0 0 8px 0;">
                    ${escapeHtml(label)}
                </div>
                <div style="font-size:18px;line-height:28px;font-weight:700;color:${valueColor};margin:0;">
                    ${valueHtml}
                </div>
            </td>
        </tr>
    `;
}

function buildBodyRow(label: string, valueHtml: string) {
    return `
        <tr>
            <td style="border:1px solid #dbe4ee;background-color:#f8fafc;padding:20px;">
                <div style="font-size:12px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:#64748b;margin:0 0 8px 0;">
                    ${escapeHtml(label)}
                </div>
                <div style="font-size:15px;line-height:28px;color:#1e293b;margin:0;">
                    ${valueHtml}
                </div>
            </td>
        </tr>
    `;
}

function buildSpacerRow(height = 14) {
    return `
        <tr>
            <td style="height:${height}px;line-height:${height}px;font-size:${height}px;padding:0;">&nbsp;</td>
        </tr>
    `;
}

function joinRows(rows: string[]) {
    return rows.map((row, index) => `${index > 0 ? buildSpacerRow(14) : ""}${row}`).join("");
}

function buildEmailShell(options: TemplateOptions) {
    const footer = options.footer ?? `Sent from the ${APP_NAME} email system.`;

    return `
        <div style="margin:0;padding:0;background-color:#eef3f8;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#eef3f8;">
                <tr>
                    <td align="center" style="padding:32px 16px 24px 16px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;border-collapse:collapse;font-family:Sohne,Inter,'Segoe UI',Arial,sans-serif;">
                            <tr>
                                <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#10b981 100%);padding:28px 28px 24px 28px;">
                                    <div style="display:inline-block;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.10);color:#ecfdf5;padding:7px 12px;font-size:12px;line-height:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                                        ${escapeHtml(options.badge)}
                                    </div>
                                    <div style="height:18px;line-height:18px;font-size:18px;">&nbsp;</div>
                                    <div style="font-size:30px;line-height:38px;font-weight:800;color:#ffffff;margin:0;">
                                        ${escapeHtml(options.title)}
                                    </div>
                                    <div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>
                                    <div style="max-width:460px;font-size:15px;line-height:28px;color:rgba(255,255,255,0.82);margin:0;">
                                        ${escapeHtml(options.description)}
                                    </div>
                                </td>
                            </tr>
                            ${buildSpacerRow(20)}
                            <tr>
                                <td style="background-color:#ffffff;border:1px solid #dbe4ee;padding:28px;">
                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
                                        ${options.sections}
                                    </table>
                                </td>
                            </tr>
                            ${buildSpacerRow(18)}
                            <tr>
                                <td align="center" style="padding:0 8px;">
                                    <div style="font-size:12px;line-height:20px;color:#64748b;margin:0;">
                                        ${escapeHtml(footer)}
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
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
        sections: joinRows([
            buildSectionRow("From", `${safeName}<div style="font-size:14px;line-height:22px;color:#475569;font-weight:500;">${safeEmail}</div>`),
            buildSectionRow("Topic", safeSubject, true),
            buildBodyRow("Message", safeMessage),
        ]),
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
        sections: joinRows([
            buildSectionRow("From", safeName),
            buildSectionRow("Topic", safeSubject, true),
            buildBodyRow("What happens next", `
                We will review your message and follow up if needed.<br />
                If your note was about a bug or feature request, it is now part of our review queue.
            `),
            buildBodyRow("Need to add details?", `
                Reply directly to this email and your response will stay attached to the same conversation.
                ${buildCtaButton("Open Bulk References", APP_URL)}
            `),
        ]),
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
        sections: joinRows([
            buildBodyRow("Secure access", `
                Use the button below to set a new password. This reset link expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"}.
                ${buildCtaButton("Reset password", safeResetUrl)}
            `),
            buildBodyRow("Did not request this?", `
                If you did not request a password reset, you can safely ignore this email. Your account remains unchanged until the reset link is used.
            `),
        ]),
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
        sections: joinRows([
            buildBodyRow("Verification", `
                Click below to confirm your email. This link expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"}.
                ${buildCtaButton("Verify email", safeVerificationUrl)}
            `),
            buildBodyRow("Why this matters", `
                Email verification helps us secure your account and make sure important product updates reach the right inbox.
            `),
        ]),
        footer: "Account verification email from Bulk References.",
    });
}

export function buildWaitlistNotificationEmailHtml(data: {
    email: string;
    persona: string;
}) {
    const safeEmail = escapeHtml(data.email);
    const safePersona = escapeHtml(data.persona);

    return buildEmailShell({
        badge: "New Waitlist Signup",
        title: "A new waitlist signup is in",
        description: "A user joined the Bulk References waitlist for latest builds and early API access.",
        sections: joinRows([
            buildSectionRow("Email", safeEmail, true),
            buildSectionRow("Persona", safePersona),
        ]),
        footer: "Sent from the Bulk References waitlist form.",
    });
}

export function buildWaitlistAutoReplyEmailHtml(data: {
    persona: string;
}) {
    const safePersona = escapeHtml(data.persona);

    return buildEmailShell({
        badge: "Waitlist Confirmed",
        title: "You're on the list",
        description: "Thanks for joining the Bulk References waitlist. We'll share latest builds, product updates, and early API access news as they become available.",
        sections: joinRows([
            buildSectionRow("Signed up as", safePersona, true),
            buildBodyRow("What you'll get", `
                Student-friendly product updates, selected early builds, and API access news as Bulk References expands from individual users into team workflows.
                ${buildCtaButton("Open Bulk References", APP_URL)}
            `),
        ]),
        footer: "This is an automatic confirmation from Bulk References.",
    });
}

async function sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
    replyToName?: string;
}): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.CONTACT_EMAIL_FROM || DEFAULT_FROM_EMAIL;
    const formattedReplyTo = params.replyTo
        ? formatMailbox(params.replyToName, params.replyTo)
        : undefined;

    if (!apiKey) {
        console.warn("[email] RESEND_API_KEY is missing. Add it to Vercel/Environment variables.");
        return { success: false, error: "API key missing" };
    }

    try {
        const resend = new Resend(apiKey);
        console.log(
            `[email] Attempting to send from ${fromEmail} to ${params.to}${formattedReplyTo ? ` with reply-to ${formattedReplyTo}` : ""}...`,
        );

        const emailResult = await resend.emails.send({
            from: fromEmail,
            to: params.to,
            subject: params.subject,
            replyTo: formattedReplyTo,
            headers: formattedReplyTo
                ? {
                    "Reply-To": formattedReplyTo,
                    "X-Reply-To": formattedReplyTo,
                }
                : undefined,
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
        replyToName: data.name,
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

export async function sendWaitlistNotification(data: {
    email: string;
    persona: string;
}): Promise<SendEmailResult> {
    return sendEmail({
        to: STATIC_TO_EMAIL,
        subject: `[Bulk References Waitlist] ${data.persona}: ${data.email}`,
        replyTo: data.email,
        replyToName: data.persona,
        html: buildWaitlistNotificationEmailHtml(data),
    });
}

export async function sendWaitlistAutoReply(data: {
    email: string;
    persona: string;
}): Promise<SendEmailResult> {
    return sendEmail({
        to: data.email,
        subject: `You're on the ${APP_NAME} waitlist`,
        html: buildWaitlistAutoReplyEmailHtml(data),
    });
}

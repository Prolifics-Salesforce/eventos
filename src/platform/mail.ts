import type { Driver } from "./outbox";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The same message as HTML: the organisation's name above, paragraphs, links
 * that can be clicked, and the unsubscribe line set apart at the foot. Built
 * from the plain text at the moment of sending, so the two can never differ
 * in what they say. ORG_NAME and BRAND_COLOR set the name and the colour.
 */
export function emailHtml(text: string, org = process.env.ORG_NAME ?? "EventOS", colour = process.env.BRAND_COLOR ?? "#6b5bd6"): string {
  const [body, footer] = text.split("\n\n—\n");
  const linked = (s: string) => escape(s).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:${colour}">${url}</a>`);
  const paragraphs = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${linked(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f3f8;font:16px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1a2b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${colour};color:#ffffff;padding:16px 28px;font-weight:700;font-size:17px">${escape(org)}</td></tr>
<tr><td style="padding:28px">${paragraphs}</td></tr>
${footer ? `<tr><td style="padding:0 28px 24px;font-size:13px;color:#77738c;border-top:1px solid #eceaf3"><p style="margin:16px 0 0">${linked(footer)}</p></td></tr>` : ""}
</table></td></tr></table></body></html>`;
}

/**
 * Email over SMTP, which every mainstream provider offers (Microsoft 365,
 * Google Workspace, Amazon SES, SendGrid, Mailgun and others).
 * SMTP_URL looks like smtps://user:password@smtp.example.com:465
 * or smtp://user:password@smtp.example.com:587 for STARTTLS.
 */
export async function smtpDriver(url: string, from: string): Promise<Driver> {
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(url);
  return async (message) => {
    const unsubscribe = message.meta?.unsubscribeUrl as string | undefined;
    await transport.sendMail({
      from, to: message.recipient, subject: message.subject ?? "", text: message.body, html: emailHtml(message.body),
      headers: unsubscribe ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
    });
  };
}

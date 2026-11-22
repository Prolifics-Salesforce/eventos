import type { Driver } from "./outbox";

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
      from, to: message.recipient, subject: message.subject ?? "", text: message.body,
      headers: unsubscribe ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
    });
  };
}

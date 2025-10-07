// utils/sendMail.js
import dotenv from "dotenv";
dotenv.config();

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

async function sendWithSendgrid({ to, subject, text, html }) {
  try {
    const sgMail = await import("@sendgrid/mail");
    sgMail.default.setApiKey(SENDGRID_KEY);
    await sgMail.default.send({
      to,
      from: process.env.MAIL_FROM || "no-reply@yourdomain.com",
      subject,
      text,
      html
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function sendWithSmtp({ to, subject, text, html }) {
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT || 587,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || `"RibbitRoom" <no-reply@yourdomain.com>`,
      to,
      subject,
      text,
      html
    });
    return { ok: true, info };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export default async function sendMail({ to, subject, text, html }) {
  // prefer sendgrid, but fallback to SMTP, otherwise log
  if (SENDGRID_KEY) {
    const res = await sendWithSendgrid({ to, subject, text, html });
    if (!res.ok) {
      console.warn("[sendMail] SendGrid failed:", res.error);
    }
    return res;
  }

  if (SMTP_HOST && SMTP_USER) {
    const res = await sendWithSmtp({ to, subject, text, html });
    if (!res.ok) console.warn("[sendMail] SMTP failed:", res.error);
    return res;
  }

  // neither provider configured
  const msg = `Mailer nicht konfiguriert. Setze SENDGRID_API_KEY oder SMTP_HOST/SMTP_USER in ENV.`;
  console.warn("[sendMail]", msg);
  console.log("Mail-Preview:", { to, subject, text, html });
  return { ok: false, error: msg };
}

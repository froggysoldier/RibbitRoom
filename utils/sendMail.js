// utils/sendMail.js
import sgMail from "@sendgrid/mail";

const FROM = process.env.EMAIL_FROM || "no-reply@yourdomain.com";

function initSendGrid() {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) {
    console.error("[sendMail] SENDGRID_API_KEY nicht gesetzt!");
    return false;
  }
  try {
    sgMail.setApiKey(key);
    return true;
  } catch (err) {
    console.error("[sendMail] Fehler beim Setzen des API Keys:", err);
    return false;
  }
}

/**
 * sendMail({ to, subject, text, html })
 * returns { ok: true, response } or { ok: false, error }
 */
export default async function sendMail({ to, subject, text, html }) {
  if (!initSendGrid()) {
    return { ok: false, error: "SENDGRID_API_KEY fehlt oder ungültig" };
  }
  if (!to) return { ok: false, error: "Empfänger fehlt" };

  const msg = {
    to,
    from: FROM,
    subject: subject || "RibbitRoom Nachricht",
    text: text || "",
    html: html || text || "",
  };

  try {
    const res = await sgMail.send(msg);
    // send liefert ein Array mit Response-Objekten
    console.log(`[sendMail] SendGrid antwort status: ${res[0]?.statusCode}`);
    return { ok: true, response: res };
  } catch (err) {
    const apiErr = err?.response?.body || err;
    console.error("[sendMail] SendGrid failed:", apiErr);
    return { ok: false, error: apiErr };
  }
}

//utils/sendMail.js
import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";
dotenv.config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * SendMail Funktion
 * @param {Object} options
 * @param {string} options.to - Empfänger
 * @param {string} options.subject - Betreff
 * @param {string} options.text - Plain Text
 * @param {string} options.html - HTML
 */
export default async function sendMail({ to, subject, text, html }) {
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error("SendGrid API Key nicht gesetzt!");
  }

  const msg = {
    to,
    from: process.env.EMAIL_FROM,
    subject,
    text,
    html
  };

  return sgMail.send(msg);
}

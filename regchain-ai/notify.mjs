// How ClinRadar reaches people: an email through the company's mail server (SMTP) and a message to a chat webhook
// (Microsoft Teams, Slack, or any system that takes JSON). No other package is needed: the SMTP client below speaks the
// protocol directly, with TLS, and the webhook is one HTTPS POST.
//
// What goes out is what an alert says: the event, the shipment, the evidence, the number of patients behind it and the
// next step. Never a patient's identity: ClinRadar holds no patient-level data.

import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const ADDRESS = /^[^\s@<>"(),;:\r\n]+@[^\s@<>"(),;:\r\n]+\.[^\s@<>"(),;:\r\n]{2,}$/;
const FORMATS = ["json", "teams", "slack"];
const SECURITY = ["starttls", "tls", "none"];

// What each channel needs, and whether it has it. Nothing secret is returned.
export function channelStatus(alerts = {}) {
  const smtp = alerts.smtp ?? {};
  const to = alerts.emailTo ?? [];
  const email = { configured: Boolean(smtp.host || to.length), recipients: to, host: smtp.host || null, port: smtp.port ?? null, security: smtp.security ?? null, problems: [] };
  if (email.configured) {
    if (!smtp.host) email.problems.push("Set REGCHAIN_SMTP_HOST to the company's mail server.");
    if (!to.length) email.problems.push("Set REGCHAIN_ALERT_EMAIL_TO to the Clinical Supply addresses.");
    const wrong = to.filter(address => !ADDRESS.test(address));
    if (wrong.length) email.problems.push("REGCHAIN_ALERT_EMAIL_TO has an address that is not valid: " + wrong.join(", ") + ".");
    if (!smtp.from) email.problems.push("Set REGCHAIN_SMTP_FROM to the sender address.");
    else if (!ADDRESS.test(smtp.from)) email.problems.push("REGCHAIN_SMTP_FROM is not a valid address.");
    if (!SECURITY.includes(smtp.security)) email.problems.push("REGCHAIN_SMTP_SECURITY is starttls, tls or none.");
    if (smtp.security === "none" && smtp.host && !LOOPBACK.has(smtp.host)) email.problems.push("REGCHAIN_SMTP_SECURITY=none is only for a mail relay on this computer. Use starttls or tls.");
    if (smtp.security === "none" && smtp.user) email.problems.push("A password is never sent without encryption. Use starttls or tls with REGCHAIN_SMTP_USER.");
    if (smtp.user && !smtp.password) email.problems.push("Set REGCHAIN_SMTP_PASSWORD for REGCHAIN_SMTP_USER.");
  }
  email.ready = email.configured && !email.problems.length;

  const hook = alerts.webhook ?? {};
  const webhook = { configured: Boolean(hook.url), format: hook.format ?? "json", host: null, problems: [] };
  if (webhook.configured) {
    let url = null;
    try { url = new URL(hook.url); } catch { webhook.problems.push("REGCHAIN_ALERT_WEBHOOK_URL is not a valid address."); }
    if (url) {
      webhook.host = url.host;
      if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, "")))) webhook.problems.push("REGCHAIN_ALERT_WEBHOOK_URL must start with https://.");
    }
    if (!FORMATS.includes(webhook.format)) webhook.problems.push("REGCHAIN_ALERT_WEBHOOK_FORMAT is teams, slack or json.");
  }
  webhook.ready = webhook.configured && !webhook.problems.length;
  return { email, webhook, any: email.ready || webhook.ready };
}

// ---------- Email (SMTP, RFC 5321) ----------

// Replies come as lines; a reply ends with "250 text" after any number of "250-text" lines.
function replyReader() {
  let buffer = "";
  let lines = [];
  const replies = [];
  const waiting = [];
  let failure = null;
  const settle = () => {
    while (waiting.length && (replies.length || failure)) {
      const next = waiting.shift();
      if (replies.length) next.resolve(replies.shift());
      else next.reject(failure);
    }
  };
  return {
    push(chunk) {
      buffer += chunk.toString("utf8");
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at).replace(/\r$/, "");
        buffer = buffer.slice(at + 1);
        lines.push(line);
        if (/^\d{3}(?: |$)/.test(line)) {
          replies.push({ code: Number(line.slice(0, 3)), lines: lines.map(item => item.slice(4)) });
          lines = [];
        }
      }
      settle();
    },
    fail(error) {
      failure ??= error;
      settle();
    },
    next() {
      return new Promise((resolve, reject) => { waiting.push({ resolve, reject }); settle(); });
    },
  };
}

const encodeHeader = value => /^[\x20-\x7e]*$/.test(value) ? value : "=?UTF-8?B?" + Buffer.from(value, "utf8").toString("base64") + "?=";
const wrap = text => text.replace(/.{1,76}/g, "$&\r\n");

export function buildMessage({ from, fromName = "ClinRadar", to, subject, text, date = new Date(), id = randomUUID() }) {
  for (const address of [from, ...to]) if (!ADDRESS.test(address)) throw new Error("Not a valid email address: " + address);
  const domain = from.split("@")[1];
  const headers = [
    `From: ${encodeHeader(fromName)} <${from}>`,
    `To: ${to.join(", ")}`,
    `Subject: ${encodeHeader(String(subject).replace(/[\r\n]+/g, " ").slice(0, 300))}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
  ];
  const body = wrap(Buffer.from(String(text).replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"));
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

function connect(smtp, timeoutMs) {
  return new Promise((resolve, reject) => {
    const options = { host: smtp.host, port: smtp.port };
    const socket = smtp.security === "tls" ? tls.connect({ ...options, servername: smtp.host }) : net.connect(options);
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`The mail server did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)));
    socket.once(smtp.security === "tls" ? "secureConnect" : "connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

// Send one message. Throws with the server's own words when it refuses.
export async function sendMail(smtp, { to, subject, text }, { timeoutMs = 20000, clientName = "clinradar.local" } = {}) {
  if (smtp.security === "none" && !LOOPBACK.has(smtp.host)) throw new Error("Unencrypted SMTP is only allowed to a relay on this computer.");
  let socket = await connect(smtp, timeoutMs);
  let reader = replyReader();
  const attach = target => {
    target.on("data", chunk => reader.push(chunk));
    target.on("error", error => reader.fail(error));
    target.on("close", () => reader.fail(new Error("The mail server closed the connection.")));
  };
  attach(socket);
  const expect = async (codes, what) => {
    const reply = await reader.next();
    if (!codes.includes(reply.code)) throw new Error(`The mail server refused ${what}: ${reply.code} ${reply.lines.join(" ").trim()}`);
    return reply;
  };
  const command = (line, codes, what) => { socket.write(line + "\r\n"); return expect(codes, what); };
  try {
    await expect([220], "the connection");
    let hello = await command(`EHLO ${clientName}`, [250], "EHLO");
    let secure = smtp.security === "tls";
    if (smtp.security === "starttls") {
      if (!hello.lines.some(line => /^STARTTLS\b/i.test(line))) throw new Error("The mail server does not offer STARTTLS. Set REGCHAIN_SMTP_SECURITY=tls if it uses port 465.");
      await command("STARTTLS", [220], "STARTTLS");
      socket.removeAllListeners("data");
      socket.removeAllListeners("close");
      socket.removeAllListeners("error");
      // The encrypted socket reports its own errors; this keeps a late error on the plain one from crashing the server.
      socket.on("error", () => {});
      reader = replyReader();
      socket = await new Promise((resolve, reject) => {
        const upgraded = tls.connect({ socket, servername: smtp.host }, () => resolve(upgraded));
        upgraded.once("error", reject);
      });
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error("The mail server stopped answering.")));
      attach(socket);
      hello = await command(`EHLO ${clientName}`, [250], "EHLO after STARTTLS");
      secure = true;
    }
    if (smtp.user) {
      if (!secure) throw new Error("A password is never sent without encryption.");
      const auth = hello.lines.find(line => /^AUTH\b/i.test(line)) ?? "";
      if (/\bPLAIN\b/i.test(auth)) {
        await command("AUTH PLAIN " + Buffer.from(`\0${smtp.user}\0${smtp.password}`, "utf8").toString("base64"), [235], "the sign-in");
      } else if (/\bLOGIN\b/i.test(auth)) {
        await command("AUTH LOGIN", [334], "the sign-in");
        await command(Buffer.from(smtp.user, "utf8").toString("base64"), [334], "the user name");
        await command(Buffer.from(smtp.password, "utf8").toString("base64"), [235], "the password");
      } else throw new Error("The mail server offers no sign-in ClinRadar supports (PLAIN or LOGIN).");
    }
    await command(`MAIL FROM:<${smtp.from}>`, [250], "the sender");
    for (const address of to) await command(`RCPT TO:<${address}>`, [250, 251], "the recipient " + address);
    await command("DATA", [354], "the message");
    const message = buildMessage({ from: smtp.from, to, subject, text });
    // Dot-stuffing: a line that starts with "." gets a second one, so it cannot end the message early.
    socket.write(message.replace(/(^|\r\n)\./g, "$1..") + "\r\n.\r\n");
    const accepted = await expect([250], "the message");
    socket.write("QUIT\r\n");
    return { accepted: accepted.lines.join(" ").trim() };
  } finally {
    socket.end();
    setTimeout(() => socket.destroy(), 1000).unref();
  }
}

// ---------- Chat webhook ----------

export function webhookBody(format, digest) {
  if (format === "slack") return { text: digest.text };
  if (format === "teams") {
    // A Teams workflow ("When a Teams webhook request is received") posts an Adaptive Card.
    const blocks = [
      { type: "TextBlock", text: digest.subject, weight: "Bolder", size: "Medium", wrap: true },
      ...digest.items.map(item => ({ type: "TextBlock", text: [`**${item.heading}**`, ...item.lines].join("\n\n"), wrap: true, separator: true })),
      { type: "TextBlock", text: digest.footer, isSubtle: true, wrap: true, separator: true },
    ];
    return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null,
      content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body: blocks } }] };
  }
  return { source: "ClinRadar", subject: digest.subject, text: digest.text, alerts: digest.alerts };
}

export async function postWebhook(webhook, digest, { timeoutMs = 15000 } = {}) {
  const response = await fetch(webhook.url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "ClinRadar/0.1 (alerts)" },
    body: JSON.stringify(webhookBody(webhook.format, digest)),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const reply = (await response.text().catch(() => "")).slice(0, 200);
  if (!response.ok) throw new Error(`The webhook answered ${response.status}${reply ? ": " + reply : ""}`);
  return { status: response.status };
}

/**
 * Pure email builders (67 §5.2) — render a family's HTML + plaintext alternative from structured inputs.
 * Deterministic (no AI) for the transactional/digest/welcome families. Email clients strip inline SVG
 * (§9), so Phase 0's welcome is text-only (no images); richer families add PNG-rendered lucide icons.
 * Every builder returns both an HTML and a plaintext body so non-HTML clients degrade gracefully.
 */

const NOT_MEDICAL =
  'SelfOS is wellness support, not medical care, and not a substitute for professional help. ' +
  'If you’re in crisis, contact your local emergency services or a crisis line.';

/** Minimal HTML entity escaping for interpolated user text (names). */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * A branded HTML shell (inline-styled — email clients ignore <style>/external CSS). Warm palette, a
 * readable single column capped at 600px (the one place a width cap is right, §"emails cap at ~600px"),
 * a title-cased brand wordmark, the not-medical footer, and an in-app unsubscribe note (the one-click
 * relay unsubscribe lands in Phase 4; until then a person stops email in Settings → Email).
 */
function shell(bodyHtml: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body style="margin:0;background:#f6f1ea;color:#2e2a25;',
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.55;\">",
    '<div style="max-width:600px;margin:0 auto;padding:32px 24px;">',
    '<div style="font-weight:700;font-size:18px;color:#241f1a;margin-bottom:20px;">SelfOS</div>',
    '<div style="background:#ffffff;border:1px solid #e7ddd0;border-radius:12px;padding:24px;">',
    bodyHtml,
    '</div>',
    `<p style="font-size:12px;color:#948b7e;margin:18px 4px 0;">${esc(NOT_MEDICAL)}</p>`,
    '<p style="font-size:12px;color:#948b7e;margin:8px 4px 0;">',
    'To stop these emails, open SelfOS → Settings → Email.</p>',
    '</div></body></html>',
  ].join('');
}

/**
 * Family G — the welcome email (67 §3.2 / Phase 0). Orientation + a getting-started nudge. The
 * `unsubscribeToken` is threaded so a later phase can embed the one-click relay unsubscribe; Phase 0 keeps
 * the in-app unsubscribe (Settings → Email).
 */
export function buildWelcomeEmail(input: {
  recipientName?: string;
  /** Reserved for the Phase-4 one-click unsubscribe link; unused in the Phase-0 body. */
  unsubscribeToken?: string;
}): ComposedEmail {
  const name = input.recipientName?.trim();
  const greeting = name ? `Welcome, ${name}` : 'Welcome to SelfOS';
  const subject = name ? `Welcome to SelfOS, ${name}` : 'Welcome to SelfOS';

  const bullets = [
    'Start a session — talk through whatever’s on your mind with your coach.',
    'Answer your onboarding so SelfOS gets to know you.',
    'Explore Memory to see what SelfOS is learning, and Sharing to control what reaches the people you relate to.',
  ];

  const html = shell(
    [
      `<h1 style="font-size:22px;margin:0 0 12px;color:#241f1a;">${esc(greeting)}</h1>`,
      '<p style="margin:0 0 14px;">SelfOS is your private, on-device space for reflection, coaching, and ',
      'keeping track of what matters to you. Everything you write stays in your own vault.</p>',
      '<p style="margin:0 0 8px;font-weight:600;">A few ways to begin:</p>',
      '<ul style="margin:0 0 16px;padding-left:20px;">',
      ...bullets.map((b) => `<li style="margin:6px 0;">${esc(b)}</li>`),
      '</ul>',
      '<p style="margin:0;color:#6e665c;">Open SelfOS whenever you’re ready — it’ll be here.</p>',
    ].join(''),
  );

  const text = [
    greeting,
    '',
    'SelfOS is your private, on-device space for reflection, coaching, and keeping track of what matters to you. Everything you write stays in your own vault.',
    '',
    'A few ways to begin:',
    ...bullets.map((b) => `- ${b}`),
    '',
    'Open SelfOS whenever you’re ready — it’ll be here.',
    '',
    NOT_MEDICAL,
    'To stop these emails, open SelfOS → Settings → Email.',
  ].join('\n');

  return { subject, html, text };
}

/** A bulletproof, inline-styled button-link (email clients ignore `<button>` + external CSS). */
function ctaButton(href: string, label: string): string {
  return [
    `<a href="${esc(href)}" style="display:inline-block;background:#3f6d63;color:#ffffff;`,
    'text-decoration:none;font-weight:600;font-size:16px;padding:12px 22px;border-radius:8px;',
    `margin:4px 0 8px;">${esc(label)}</a>`,
  ].join('');
}

/**
 * Family A — the questionnaire-delivery email (67 §3.2 / Phase 1). SelfOS's first real send to a
 * RECIPIENT (rather than the app's own user): a branded wrapper around the sender's friendly note (the
 * editable message from `RelayLinkDelivery`, which already carries the secure relay link + PIN inline),
 * plus a prominent one-click CTA button to the link. The `message` is treated as plain text — escaped and
 * split into paragraphs — so what the sender sees in the compose field is exactly what's sent, just
 * branded. The plaintext alternative is the message verbatim (link + PIN included), so non-HTML clients
 * still work. No inline SVG (§9).
 */
export function buildQuestionnaireDeliveryEmail(input: {
  subject: string;
  message: string;
  link: string;
}): ComposedEmail {
  const paragraphs = input.message
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p style="margin:0 0 14px;">${esc(block).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const html = shell([ctaButton(input.link, 'Open your questionnaire'), paragraphs].join(''));

  return { subject: input.subject, html, text: input.message };
}

/**
 * Family B — a transactional alert (67 §3.2 / Phase 2). A branded teaser mirroring an in-app notification
 * (35): the notification's title as the heading, its optional body as a line, and an "Open SelfOS" prompt.
 * Deliberately content-light — a `together-turn` alert never carries the message, only that it's your turn
 * (§3.11). The subject is the title. The one-click `selfos://` deep link lands with Phase 4; until then the
 * prompt is plain text (no dead link). No inline SVG (§9).
 */
export function buildTransactionalEmail(input: { title: string; body?: string }): ComposedEmail {
  const title = input.title.trim();
  const body = input.body?.trim();

  const html = shell(
    [
      `<h1 style="font-size:20px;margin:0 0 12px;color:#241f1a;">${esc(title)}</h1>`,
      body ? `<p style="margin:0 0 14px;">${esc(body)}</p>` : '',
      '<p style="margin:0;color:#6e665c;">Open SelfOS to see it.</p>',
    ].join(''),
  );

  const text = [
    title,
    ...(body ? ['', body] : []),
    '',
    'Open SelfOS to see it.',
    '',
    NOT_MEDICAL,
  ].join('\n');

  return { subject: title, html, text };
}

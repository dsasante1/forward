/**
 * Branded HTML email shell + builders, kept separate from the services that
 * send mail so every message looks like the product. Email clients are stuck in
 * ~2003: no flexbox/grid, patchy `<style>` support, so everything here is
 * table-based with inline styles and web-safe fonts. Always pair the HTML with a
 * plain-text alternative (deliverability + accessibility).
 */

// Forward brand palette (mirrors apps/dashboard/src/styles.css).
const BRAND = {
  bg: "#efe8da",
  panel: "#ffffff",
  ink: "#1c1a15",
  muted: "#57514a",
  faint: "#8a837a",
  accent: "#bf5a36",
  border: "#e2dac9",
} as const;

export interface EmailLayoutOptions {
  /** Inbox preview snippet (hidden in the body). */
  preview: string;
  /** The main message body, already-escaped HTML, dropped into the card. */
  contentHtml: string;
}

/** Wrap content in the branded shell: logo header, card, footer. */
export function emailLayout({ preview, contentHtml }: EmailLayoutOptions): string {
  const font =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Forward</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.bg};font-size:1px;line-height:1px;">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
    <tr><td style="padding:4px 4px 20px;">
      <span style="font-family:${font};font-size:15px;font-weight:700;letter-spacing:3px;color:${BRAND.ink};"><span style="color:${BRAND.accent};letter-spacing:0;">&#9656;&#9656;</span>&nbsp; FORWARD</span>
    </td></tr>
    <tr><td style="background:${BRAND.panel};border:1px solid ${BRAND.border};border-radius:12px;padding:32px 32px 28px;">
      ${contentHtml}
    </td></tr>
    <tr><td style="padding:20px 8px 0;">
      <p style="margin:0;font-family:${font};font-size:12px;line-height:18px;color:${BRAND.faint};">
        Forward &mdash; keeping design and backend in sync.
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** A "bulletproof" table-cell button that renders across email clients. */
function button(label: string, href: string): string {
  const font =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td align="center" bgcolor="${BRAND.accent}" style="border-radius:8px;">
      <a href="${href}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${font};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
    </td>
  </tr></table>`;
}

export interface InviteEmailParams {
  projectName: string;
  role: string;
  link: string;
  expiresDays: number;
}

/** The project-invitation email: subject + plain-text + branded HTML. */
export function inviteEmail({
  projectName,
  role,
  link,
  expiresDays,
}: InviteEmailParams): { subject: string; text: string; html: string } {
  const name = escapeHtml(projectName);
  const safeRole = escapeHtml(role);
  const font =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const contentHtml = `
    <h1 style="margin:0 0 16px;font-family:${font};font-size:22px;line-height:28px;font-weight:700;color:${BRAND.ink};">You're invited to join ${name}</h1>
    <p style="margin:0 0 24px;font-family:${font};font-size:15px;line-height:23px;color:${BRAND.muted};">
      You've been added to the project <strong style="color:${BRAND.ink};">${name}</strong> as
      <strong style="color:${BRAND.ink};">${safeRole}</strong> on Forward. Accept the invitation to start collaborating.
    </p>
    ${button("Accept invitation", link)}
    <p style="margin:24px 0 0;font-family:${font};font-size:13px;line-height:20px;color:${BRAND.muted};">
      Or paste this link into your browser:<br>
      <a href="${link}" target="_blank" style="color:${BRAND.accent};word-break:break-all;">${escapeHtml(link)}</a>
    </p>
    <hr style="border:none;border-top:1px solid ${BRAND.border};margin:24px 0 0;">
    <p style="margin:16px 0 0;font-family:${font};font-size:12px;line-height:18px;color:${BRAND.faint};">
      This invitation expires in ${expiresDays} days. If you weren't expecting it, you can safely ignore this email.
    </p>`;

  return {
    subject: `You've been invited to "${projectName}" on Forward`,
    text:
      `You're invited to join the project "${projectName}" as ${role} on Forward.\n\n` +
      `Accept your invitation:\n${link}\n\n` +
      `This link expires in ${expiresDays} days. ` +
      `If you weren't expecting it, you can ignore this email.`,
    html: emailLayout({
      preview: `Join ${projectName} as ${role} on Forward`,
      contentHtml,
    }),
  };
}

/** Escape user-supplied text for safe interpolation into HTML. */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );
}

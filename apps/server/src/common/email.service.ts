import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface SendEmailInput {
  to: string | EmailAddress | Array<string | EmailAddress>;
  subject: string;
  /** At least one of `text` / `html` should be provided. */
  text?: string;
  html?: string;
  /** Override the default From for this message (rarely needed). */
  from?: EmailAddress;
}

/**
 * Outbound transactional email, sent through Mailtrap's Email Sending API.
 *
 * It is deliberately best-effort and lazily configured: if `MAILTRAP_API_KEY`
 * is absent the service logs a warning and no-ops, so the server boots and the
 * core API works without email wired up (mirrors how RealtimeService treats a
 * failed broadcast). Callers should never let a notification failure roll back a
 * real write — send after the write commits, not inside its transaction.
 *
 * Config (apps/server/.env):
 *   MAILTRAP_API_KEY    — Mailtrap sending token (secret, server-only).
 *   DEFAULT_FROM_EMAIL  — default sender, "Name <email@domain>" or "email@domain".
 *   MAILTRAP_API_URL    — optional; defaults to the production send endpoint.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey?: string;
  private readonly apiUrl: string;
  private readonly from: EmailAddress;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>("MAILTRAP_API_KEY");
    this.apiUrl =
      config.get<string>("MAILTRAP_API_URL") ??
      "https://send.api.mailtrap.io/api/send";
    this.from = parseAddress(
      config.get<string>("DEFAULT_FROM_EMAIL") ?? "no-reply@localhost",
    );
    if (!this.apiKey) {
      this.logger.warn(
        "MAILTRAP_API_KEY not set — email notifications are disabled (no-op).",
      );
    }
  }

  /** Whether outbound email is actually configured. */
  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Send one email. Returns `true` if Mailtrap accepted it, `false` if email is
   * disabled or the send failed (the error is logged, never thrown — see above).
   */
  async send(input: SendEmailInput): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.debug(`Email skipped (disabled): "${input.subject}"`);
      return false;
    }

    const to = (Array.isArray(input.to) ? input.to : [input.to]).map(toAddress);
    const body = {
      from: input.from ?? this.from,
      to,
      subject: input.subject,
      ...(input.text ? { text: input.text } : {}),
      ...(input.html ? { html: input.html } : {}),
    };

    try {
      const res = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          // Mailtrap's Email API authenticates with the Api-Token header.
          "Api-Token": this.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        this.logger.warn(
          `Mailtrap send failed (${res.status}) for "${input.subject}": ${detail}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Mailtrap send error for "${input.subject}": ${(err as Error).message}`,
      );
      return false;
    }
  }
}

function toAddress(value: string | EmailAddress): EmailAddress {
  return typeof value === "string" ? { email: value } : value;
}

/** Parse `"Forward <no-reply@example.com>"` or a bare address into name + email. */
function parseAddress(raw: string): EmailAddress {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const [, name, email] = match;
    return { email: email!.trim(), ...(name ? { name: name.trim() } : {}) };
  }
  return { email: raw.trim() };
}

import {
  validateWaitlistRequest,
  type WaitlistRequest,
} from "@encois/contracts";
import { waitlistRequests } from "@encois/persistence";
import type { Context, Handler } from "hono";
import { database } from "../database.js";
import type { GatewayEnv } from "../middleware/aos.js";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const RATE_LIMIT_MAX = 5;
// TODO: replace this process-local limiter with edge/Redis-backed limiting
// before exposing the waitlist on a multi-instance Cloud Run deployment.
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(context: Context<GatewayEnv>, email: string): string {
  const forwardedFor =
    context.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${forwardedFor}:${email}`;
}

function consumeRateLimit(key: string): boolean {
  const now = Date.now();
  if (attempts.size >= 10_000) {
    for (const [storedKey, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(storedKey);
    }
    if (attempts.size >= 10_000 && !attempts.has(key)) return false;
  }
  const previous = attempts.get(key);
  if (!previous || previous.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (previous.count >= RATE_LIMIT_MAX) return false;
  previous.count += 1;
  return true;
}

export const submitWaitlistRoute: Handler<GatewayEnv> = async (context) => {
  const body: unknown = await context.req.json().catch(() => null);
  const validation = validateWaitlistRequest(body);
  if (!validation.ok) {
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: validation.issue.message,
          ...(validation.issue.field ? { field: validation.issue.field } : {}),
          requestId: context.get("requestId"),
          traceId: context.get("traceId"),
        },
      },
      400,
    );
  }

  if (!database) {
    return context.json(
      {
        error: {
          code: "PERSISTENCE_UNAVAILABLE",
          message: "Waitlist submissions are not configured.",
          requestId: context.get("requestId"),
          traceId: context.get("traceId"),
        },
      },
      503,
    );
  }

  if (!consumeRateLimit(clientKey(context, validation.value.email))) {
    return context.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Please try again later.",
          requestId: context.get("requestId"),
          traceId: context.get("traceId"),
        },
      },
      429,
    );
  }

  const value: WaitlistRequest = validation.value;

  await database
    .insert(waitlistRequests)
    .values({
      emailNormalized: value.email,
      companyName: value.companyName,
      ...(value.companyWebsite ? { companyWebsite: value.companyWebsite } : {}),
      ...(value.companyLinkedinUrl
        ? { companyLinkedinUrl: value.companyLinkedinUrl }
        : {}),
      ...(value.displayName ? { displayName: value.displayName } : {}),
      ...(value.message ? { message: value.message } : {}),
    })
    .onConflictDoNothing({ target: waitlistRequests.emailNormalized });

  return context.json({ data: { accepted: true } }, 202);
};

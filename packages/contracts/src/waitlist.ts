import { isJsonObject } from "./json.js";

export const WaitlistLimits = {
  email: 320,
  companyName: 160,
  companyUrl: 500,
  displayName: 160,
  message: 2_000,
} as const;

const commonFreeEmailDomains = new Set([
  "10minutemail.com",
  "126.com",
  "163.com",
  "aol.com",
  "fastmail.com",
  "gmail.com",
  "gmx.com",
  "googlemail.com",
  "hey.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.ru",
  "me.com",
  "mac.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "tutanota.com",
  "yahoo.com",
  "yandex.com",
  "yopmail.com",
  "zoho.com",
]);

export type WaitlistRequest = {
  email: string;
  companyName: string;
  companyWebsite?: string;
  companyLinkedinUrl?: string;
  displayName?: string;
  message?: string;
};

export type WaitlistValidationField = keyof WaitlistRequest;

export type WaitlistValidationResult =
  | { ok: true; value: WaitlistRequest }
  | { ok: false; issue: { field?: WaitlistValidationField; message: string } };

function optionalText(
  input: Record<string, unknown>,
  field: WaitlistValidationField,
  maxLength: number,
): { value?: string } | { issue: { field: WaitlistValidationField; message: string } } {
  const value = input[field];
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") return { issue: { field, message: "This field must be text." } };

  const trimmed = value.trim();
  if (!trimmed) return {};
  if (trimmed.length > maxLength) return { issue: { field, message: `This field must be ${maxLength} characters or fewer.` } };
  return { value: trimmed };
}

function requiredText(
  input: Record<string, unknown>,
  field: "companyName",
  maxLength: number,
): { value: string } | { issue: { field: WaitlistValidationField; message: string } } {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    return { issue: { field, message: "Company name is required." } };
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) return { issue: { field, message: `This field must be ${maxLength} characters or fewer.` } };
  return { value: trimmed };
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

function isCompanyLinkedinUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  if (!url || !(url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com"))) return false;
  return /^\/company(?:\/|$)/i.test(url.pathname);
}

function isWorkEmail(value: string): boolean {
  if (value.length > WaitlistLimits.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  const domain = value.slice(value.lastIndexOf("@") + 1).toLowerCase();
  return !commonFreeEmailDomains.has(domain);
}

/**
 * Shared browser/API validation. It proves only a plausible work email; real
 * mailbox ownership still requires an email verification step later.
 */
export function validateWaitlistRequest(input: unknown): WaitlistValidationResult {
  if (!isJsonObject(input)) return { ok: false, issue: { message: "A waitlist request is required." } };

  const rawEmail = input.email;
  const email = typeof rawEmail === "string" ? rawEmail.normalize("NFKC").trim().toLowerCase() : "";
  if (!isWorkEmail(email)) {
    return { ok: false, issue: { field: "email", message: "Use a valid work email address, not a personal mailbox." } };
  }

  const company = requiredText(input, "companyName", WaitlistLimits.companyName);
  if ("issue" in company) return { ok: false, issue: company.issue };

  const website = optionalText(input, "companyWebsite", WaitlistLimits.companyUrl);
  if ("issue" in website) return { ok: false, issue: website.issue };
  if (website.value && !parseHttpUrl(website.value)) {
    return { ok: false, issue: { field: "companyWebsite", message: "Enter a valid company website URL." } };
  }

  const linkedin = optionalText(input, "companyLinkedinUrl", WaitlistLimits.companyUrl);
  if ("issue" in linkedin) return { ok: false, issue: linkedin.issue };
  if (linkedin.value && !isCompanyLinkedinUrl(linkedin.value)) {
    return { ok: false, issue: { field: "companyLinkedinUrl", message: "Enter a company LinkedIn URL." } };
  }

  if (!website.value && !linkedin.value) {
    return {
      ok: false,
      issue: { field: "companyWebsite", message: "Add a company website or company LinkedIn URL." },
    };
  }

  const displayName = optionalText(input, "displayName", WaitlistLimits.displayName);
  if ("issue" in displayName) return { ok: false, issue: displayName.issue };
  const message = optionalText(input, "message", WaitlistLimits.message);
  if ("issue" in message) return { ok: false, issue: message.issue };

  return {
    ok: true,
    value: {
      email,
      companyName: company.value,
      ...(website.value ? { companyWebsite: website.value } : {}),
      ...(linkedin.value ? { companyLinkedinUrl: linkedin.value } : {}),
      ...(displayName.value ? { displayName: displayName.value } : {}),
      ...(message.value ? { message: message.value } : {}),
    },
  };
}

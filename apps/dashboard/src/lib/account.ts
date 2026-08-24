import { getAuthIdentity, getAuthSession } from "@/lib/auth";
import type { OrganizationMember } from "@/lib/organization";

export type AccountSummary = {
  name: string;
  email: string;
  initials: string;
};

export function getAccountSummary(
  members: readonly OrganizationMember[] = [],
): AccountSummary {
  const identity = getAuthIdentity();
  const session = getAuthSession();
  const currentMember =
    members.find((member) => member.id === session?.userId) ??
    (identity.email
      ? members.find(
          (member) =>
            member.email.toLowerCase() === identity.email?.toLowerCase(),
        )
      : undefined);
  const name =
    identity.displayName || currentMember?.name || identity.email || "Account";
  const email =
    identity.email ||
    (currentMember?.email && currentMember.email !== "No email available"
      ? currentMember.email
      : "Email unavailable");

  return {
    name,
    email,
    initials: currentMember?.initials || initials(name),
  };
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`
      : value.slice(0, 2)
  ).toUpperCase();
}

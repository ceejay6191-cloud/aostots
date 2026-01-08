export type EntitlementsMap = Record<string, any>;

export function isFeatureEnabled(entitlements: EntitlementsMap | null | undefined, key: string) {
  return Boolean(entitlements && entitlements[key]);
}

export function getEntitlementLimit(entitlements: EntitlementsMap | null | undefined, key: string) {
  if (!entitlements) return null;
  const value = entitlements[key];
  if (typeof value === "number" || typeof value === "string") return value;
  return value ? "Enabled" : null;
}

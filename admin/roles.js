export const tabsByRole = Object.freeze({
  system_admin: ["users", "config", "geofences", "reviews", "reconciliation", "audit"],
  org_admin: ["users", "config", "geofences", "reviews", "reconciliation", "audit"],
  reviewer: ["geofences", "reviews"],
  auditor: ["geofences", "audit"],
  field_agent: [],
});

export function allowedTabsForRole(role) {
  return tabsByRole[role] ?? [];
}

export function canAdministerOrganization(role) {
  return role === "system_admin" || role === "org_admin";
}

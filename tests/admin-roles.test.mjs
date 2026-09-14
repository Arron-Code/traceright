import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedTabsForRole,
  canAdministerOrganization,
} from "../admin/roles.js";

test("admin role matrix starts each role on an authorized tab", () => {
  assert.equal(allowedTabsForRole("system_admin")[0], "users");
  assert.equal(allowedTabsForRole("org_admin")[0], "users");
  assert.equal(allowedTabsForRole("reviewer")[0], "geofences");
  assert.equal(allowedTabsForRole("auditor")[0], "geofences");
  assert.deepEqual(allowedTabsForRole("field_agent"), []);
});

test("only administrator roles receive mutating organization controls", () => {
  assert.equal(canAdministerOrganization("system_admin"), true);
  assert.equal(canAdministerOrganization("org_admin"), true);
  assert.equal(canAdministerOrganization("reviewer"), false);
  assert.equal(canAdministerOrganization("auditor"), false);
});

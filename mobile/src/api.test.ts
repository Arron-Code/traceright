import assert from "node:assert/strict";
import test from "node:test";
import { configureApiSession, getCurrentAuthHeaders, login } from "./api";

test("login forwards the optional organization slug", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = "https://mobile.test";
  let requestBody: unknown;

  configureApiSession(null, () => undefined);
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      data: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresIn: 300,
        user: { id: "user-1", email: "field@example.com" },
        organizations: [{ id: "org-1", name: "Organization" }],
        selectedOrganizationId: "org-1",
      },
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    configureApiSession(null, () => undefined);
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  await login("field@example.com", "secret", "coffee-cooperative");

  assert.deepEqual(requestBody, {
    email: "field@example.com",
    password: "secret",
    organizationSlug: "coffee-cooperative",
  });
  assert.deepEqual(await getCurrentAuthHeaders(), {
    Authorization: "Bearer access",
    "X-Organization-Id": "org-1",
  });
  await assert.rejects(
    () => getCurrentAuthHeaders({ userId: "user-1", organizationId: "org-2" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_SCOPE_CHANGED",
  );
});

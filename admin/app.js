import { allowedTabsForRole, canAdministerOrganization } from "./roles.js";

const state = {
  accessToken: sessionStorage.getItem("accessToken"),
  refreshToken: sessionStorage.getItem("refreshToken"),
  user: null,
  organizations: [],
  organizationId: null,
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function message(text, error = false) {
  const element = $("#message");
  element.textContent = text;
  element.className = error ? "visible error" : "visible";
  setTimeout(() => { element.className = ""; }, 4000);
}

async function api(path, options = {}, retry = true) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401 && retry && state.refreshToken && path !== "/api/v1/auth/refresh") {
    const refreshed = await api("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    }, false).catch(() => null);
    if (refreshed) {
      saveTokens(refreshed);
      return api(path, options, false);
    }
  }
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return body.data;
}

function saveTokens(tokens) {
  state.accessToken = tokens.accessToken;
  state.refreshToken = tokens.refreshToken;
  sessionStorage.setItem("accessToken", tokens.accessToken);
  sessionStorage.setItem("refreshToken", tokens.refreshToken);
}

function logout() {
  state.accessToken = null;
  state.refreshToken = null;
  state.user = null;
  sessionStorage.clear();
  $("#workspace").classList.add("hidden");
  $("#logout").classList.add("hidden");
  $("#login-panel").classList.remove("hidden");
}

async function loadOrganizations() {
  state.organizations = await api("/api/v1/admin/organizations");
  const select = $("#organization-select");
  select.innerHTML = state.organizations
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(item.slug)})</option>`)
    .join("");
  state.organizationId = state.user.organizationId ??
    (state.organizations.some((item) => item.id === state.organizationId)
      ? state.organizationId
      : state.organizations[0]?.id ?? null);
  select.value = state.organizationId ?? "";
  showSelectedOrganization();
  if (state.organizationId) await loadActiveTab();
}

function showSelectedOrganization() {
  const form = $("#organization-edit-form");
  const organization = state.organizations.find((item) => item.id === state.organizationId);
  if (!organization || state.user?.role !== "system_admin") return;
  form.elements.name.value = organization.name;
  form.elements.active.checked = organization.active;
}

function configureRoleUi() {
  const allowed = new Set(allowedTabsForRole(state.user?.role));
  const buttons = [...document.querySelectorAll(".tabs button")];
  buttons.forEach((button) => {
    button.classList.toggle("hidden", !allowed.has(button.dataset.tab));
    button.classList.remove("active");
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  document.querySelectorAll(".system-only").forEach((element) =>
    element.classList.toggle("hidden", state.user?.role !== "system_admin"));
  document.querySelectorAll(".admin-only").forEach((element) =>
    element.classList.toggle("hidden", !canAdministerOrganization(state.user?.role)));
  const first = buttons.find((button) => allowed.has(button.dataset.tab));
  if (!first) return false;
  first.classList.add("active");
  $(`#tab-${first.dataset.tab}`).classList.remove("hidden");
  return true;
}

function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table></div>`;
}

async function loadUsers() {
  const users = await api(`/api/v1/admin/organizations/${state.organizationId}/users`);
  $("#users").innerHTML = table(["E-Mail", "Name", "Rolle", "Aktiv", "Aktion"], users.map((user) =>
    `<tr><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.displayName)}</td>` +
    `<td><select data-user-role="${user.id}">${["org_admin", "reviewer", "field_agent", "auditor"]
      .map((role) => `<option ${role === user.role ? "selected" : ""}>${role}</option>`).join("")}</select></td>` +
    `<td>${user.active ? "Ja" : "Nein"}</td><td><button data-user-toggle="${user.id}" data-active="${user.active}">` +
    `${user.active ? "Deaktivieren" : "Aktivieren"}</button></td></tr>`));
}

async function loadConfig() {
  const config = await api(`/api/v1/admin/organizations/${state.organizationId}/config`);
  const form = $("#config-form");
  form.satelliteEnabled.checked = config.satelliteEnabled;
  form.satelliteEndpoint.value = config.satelliteEndpoint ?? "";
  form.satelliteApiKey.placeholder = config.hasSatelliteApiKey ? "Gespeichert (wird nicht angezeigt)" : "";
  form.evidencePackEnabled.checked = config.evidencePackEnabled;
  form.mode.value = config.eu.mode;
  form.endpoint.value = config.eu.endpoint ?? "";
  form.timeoutMs.value = config.eu.timeoutMs;
  form.username.placeholder = config.eu.hasUsername ? "Gespeichert (wird nicht angezeigt)" : "";
  form.euPassword.placeholder = config.eu.hasPassword ? "Gespeichert (wird nicht angezeigt)" : "";
  form.clientId.placeholder = config.eu.hasClientId ? "Gespeichert (wird nicht angezeigt)" : "";
}

async function loadGeofences() {
  const items = await api(`/api/v1/admin/organizations/${state.organizationId}/geofences`);
  const canEdit = canAdministerOrganization(state.user?.role);
  $("#geofences").innerHTML = table(["Name", "Status", "GeoJSON", "Aktion"], items.map((item) =>
    `<tr><td>${escapeHtml(item.name)}</td><td>${item.active ? "Aktiv" : "Inaktiv"}</td>` +
    `<td><code>${escapeHtml(JSON.stringify(item.polygon))}</code></td>` +
    `<td>${canEdit ? `<button data-geofence-toggle="${item.id}" data-active="${item.active}">${item.active ? "Deaktivieren" : "Aktivieren"}</button>` : "Nur Lesen"}</td></tr>`));
}

async function loadReviews() {
  const items = await api(`/api/v1/admin/organizations/${state.organizationId}/reviews`);
  $("#reviews").innerHTML = table(["Typ", "Objekt", "Status", "Grund", "Aktion"], items.map((item) =>
    `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.subjectId)}</td>` +
    `<td><span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>` +
    `<td>${escapeHtml(item.reason)}</td><td class="actions">${item.status === "pending" ?
      `<button data-review="${item.type}:${item.id}:approved">Freigeben</button>` +
      `<button class="danger" data-review="${item.type}:${item.id}:rejected">Ablehnen</button>` : ""}</td></tr>`));
}

async function loadAudit() {
  const items = await api(`/api/v1/admin/organizations/${state.organizationId}/audit-logs?limit=100`);
  $("#audit").innerHTML = table(["Zeit", "Aktion", "Ressource", "Details"], items.map((item) =>
    `<tr><td>${escapeHtml(new Date(item.createdAt).toLocaleString())}</td>` +
    `<td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.resourceType)} ${escapeHtml(item.resourceId ?? "")}</td>` +
    `<td><code>${escapeHtml(JSON.stringify(item.details))}</code></td></tr>`));
}

async function loadReconciliation() {
  const items = await api(`/api/v1/admin/organizations/${state.organizationId}/dds-reconciliation`);
  $("#reconciliation").innerHTML = table(
    ["DDS", "Status", "Phase", "Fehler", "Aktualisiert", "Aktion"],
    items.map((item) =>
      `<tr><td>${escapeHtml(item.operationId)}<br><small>${escapeHtml(item.subjectId)}</small></td>` +
      `<td><span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>` +
      `<td>${escapeHtml(item.operationPhase)}</td><td>${escapeHtml(item.errorCode ?? "")}</td>` +
      `<td>${escapeHtml(new Date(item.updatedAt).toLocaleString())}</td><td class="actions">` +
      `<button data-reconcile="${item.id}:confirm_submitted">Extern bestätigt</button>` +
      `<button class="danger" data-reconcile="${item.id}:reset_not_submitted">Nicht eingereicht</button></td></tr>`),
  );
}

const loaders = {
  users: loadUsers,
  config: loadConfig,
  geofences: loadGeofences,
  reviews: loadReviews,
  reconciliation: loadReconciliation,
  audit: loadAudit,
};
async function loadActiveTab() {
  const active = $(".tabs button.active")?.dataset.tab;
  if (!active) return;
  try { await loaders[active](); } catch (error) { message(error.message, true); }
}

async function initialize() {
  if (!state.accessToken) return;
  try {
    state.user = await api("/api/v1/auth/me");
    $("#login-panel").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    $("#logout").classList.remove("hidden");
    if (!configureRoleUi()) {
      logout();
      message("Diese Rolle besitzt keinen Zugriff auf den Adminbereich.", true);
      return;
    }
    await loadOrganizations();
  } catch {
    logout();
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        ...(form.get("organizationSlug") ? { organizationSlug: form.get("organizationSlug") } : {}),
      }),
    });
    saveTokens(result);
    await initialize();
  } catch (error) { message(error.message, true); }
});

$("#logout").addEventListener("click", async () => {
  if (state.refreshToken) {
    await api("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    }).catch(() => null);
  }
  logout();
});

$("#organization-select").addEventListener("change", async (event) => {
  state.organizationId = event.target.value;
  showSelectedOrganization();
  await loadActiveTab();
});

$("#organization-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), slug: form.get("slug") }),
    });
    event.currentTarget.reset();
    await loadOrganizations();
    message("Organisation angelegt.");
  } catch (error) { message(error.message, true); }
});

$("#organization-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: event.currentTarget.elements.name.value,
        active: event.currentTarget.elements.active.checked,
      }),
    });
    await loadOrganizations();
    message("Organisation gespeichert.");
  } catch (error) { message(error.message, true); }
});

$("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/users`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form)),
    });
    event.currentTarget.reset();
    await loadUsers();
    message("Benutzer angelegt.");
  } catch (error) { message(error.message, true); }
});

$("#users").addEventListener("change", async (event) => {
  if (!event.target.dataset.userRole) return;
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/users/${event.target.dataset.userRole}`, {
      method: "PATCH",
      body: JSON.stringify({ role: event.target.value }),
    });
    message("Rolle aktualisiert.");
  } catch (error) { message(error.message, true); await loadUsers(); }
});

$("#users").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-user-toggle]");
  if (!button) return;
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/users/${button.dataset.userToggle}`, {
      method: "PATCH",
      body: JSON.stringify({ active: button.dataset.active !== "true" }),
    });
    await loadUsers();
  } catch (error) { message(error.message, true); }
});

$("#config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const secret = (field, clear) => clear.checked ? null : field.value || undefined;
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/config`, {
      method: "PUT",
      body: JSON.stringify({
        satelliteEnabled: form.satelliteEnabled.checked,
        satelliteEndpoint: form.satelliteEndpoint.value || null,
        satelliteApiKey: secret(form.satelliteApiKey, form.clearSatelliteApiKey),
        evidencePackEnabled: form.evidencePackEnabled.checked,
        eu: {
          mode: form.mode.value,
          endpoint: form.endpoint.value || null,
          timeoutMs: Number(form.timeoutMs.value),
          username: secret(form.username, form.clearUsername),
          password: secret(form.euPassword, form.clearPassword),
          clientId: secret(form.clientId, form.clearClientId),
        },
        extra: {},
      }),
    });
    form.username.value = form.euPassword.value = form.clientId.value = form.satelliteApiKey.value = "";
    form.clearUsername.checked = form.clearPassword.checked =
      form.clearClientId.checked = form.clearSatelliteApiKey.checked = false;
    await loadConfig();
    message("Konfiguration gespeichert.");
  } catch (error) { message(error.message, true); }
});

$("#geofence-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/geofences`, {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), polygon: JSON.parse(form.get("polygon")), active: true }),
    });
    await loadGeofences();
    message("Geofence angelegt.");
  } catch (error) { message(error.message, true); }
});

$("#geofences").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-geofence-toggle]");
  if (!button) return;
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/geofences/${button.dataset.geofenceToggle}`, {
      method: "PATCH",
      body: JSON.stringify({ active: button.dataset.active !== "true" }),
    });
    await loadGeofences();
  } catch (error) { message(error.message, true); }
});

$("#reviews").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-review]");
  if (!button) return;
  const [type, id, decision] = button.dataset.review.split(":");
  try {
    await api(`/api/v1/admin/reviews/${type}/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note: "" }),
    });
    await loadReviews();
    message("Review aktualisiert.");
  } catch (error) { message(error.message, true); }
});

$("#reconciliation").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-reconcile]");
  if (!button) return;
  const [actionId, decision] = button.dataset.reconcile.split(":");
  const note = window.prompt("Begründung der Reconciliation:");
  if (!note) return;
  const externalReference = decision === "confirm_submitted"
    ? window.prompt("Bestätigte externe DDS-Referenz:")
    : undefined;
  if (decision === "confirm_submitted" && !externalReference) return;
  try {
    await api(`/api/v1/admin/dds-actions/${actionId}/reconcile`, {
      method: "POST",
      body: JSON.stringify({ decision, note, externalReference }),
    });
    await loadReconciliation();
    message("DDS-Reconciliation gespeichert.");
  } catch (error) { message(error.message, true); }
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", async () => {
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((item) => item.classList.add("hidden"));
    button.classList.add("active");
    $(`#tab-${button.dataset.tab}`).classList.remove("hidden");
    await loadActiveTab();
  });
});

void initialize();

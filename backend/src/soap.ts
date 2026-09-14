import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { AppConfig } from "./config.js";
import { decryptSecret } from "./security.js";

export type EuAdapterConfig = {
  mode: "mock" | "live";
  endpoint: string | null;
  timeoutMs: number;
  usernameCiphertext: string | null;
  passwordCiphertext: string | null;
  clientIdCiphertext: string | null;
};

export type DdsPayload = {
  id: string;
  subjectId: string;
  organizationId: string;
};

export class EuSubmissionError extends Error {
  constructor(
    readonly outcome: "failed" | "uncertain",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EuSubmissionError";
  }
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildDdsEnvelope(payload: DdsPayload, clientId?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eudr="urn:eu:eudr:v3">` +
    `<soap:Header/><soap:Body><eudr:SubmitDDS>` +
    `<eudr:ClientRequestId>${xml(payload.id)}</eudr:ClientRequestId>` +
    `<eudr:OrganisationId>${xml(payload.organizationId)}</eudr:OrganisationId>` +
    `<eudr:SubjectId>${xml(payload.subjectId)}</eudr:SubjectId>` +
    (clientId ? `<eudr:ClientId>${xml(clientId)}</eudr:ClientId>` : "") +
    `</eudr:SubmitDDS></soap:Body></soap:Envelope>`;
}

function isPrivateAddress(hostname: string): boolean {
  return (
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("127.") ||
    hostname.startsWith("169.254.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

async function assertSafeEndpoint(endpoint: string): Promise<URL> {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") {
    throw new Error("Live EU endpoint must use HTTPS.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isPrivateAddress(hostname)
  ) {
    throw new Error("Private or loopback EU endpoint is not allowed.");
  }
  if (!isIP(hostname)) {
    const addresses = await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error("EU endpoint resolves to a private or unavailable address.");
    }
  }
  return url;
}

function parseReference(response: string): string | null {
  const match = response.match(/<(?:\w+:)?(?:referenceNumber|DDSReference|Reference)>([^<]+)</i);
  return match?.[1]?.trim() ?? null;
}

export async function submitDds(
  appConfig: AppConfig,
  adapterConfig: EuAdapterConfig,
  payload: DdsPayload,
  fetchImplementation: typeof fetch = fetch,
): Promise<{ reference: string; mock: boolean }> {
  if (adapterConfig.mode === "mock") {
    return { reference: `MOCK-${payload.id.slice(0, 8).toUpperCase()}`, mock: true };
  }
  if (!adapterConfig.endpoint) {
    throw new EuSubmissionError("failed", "EU endpoint is not configured.");
  }
  let endpoint: URL;
  let username: string;
  let password: string;
  let clientId: string | undefined;
  try {
    endpoint = await assertSafeEndpoint(adapterConfig.endpoint);
    username = adapterConfig.usernameCiphertext
      ? decryptSecret(appConfig.CONFIG_ENCRYPTION_KEY, adapterConfig.usernameCiphertext)
      : "";
    password = adapterConfig.passwordCiphertext
      ? decryptSecret(appConfig.CONFIG_ENCRYPTION_KEY, adapterConfig.passwordCiphertext)
      : "";
    clientId = adapterConfig.clientIdCiphertext
      ? decryptSecret(appConfig.CONFIG_ENCRYPTION_KEY, adapterConfig.clientIdCiphertext)
      : undefined;
  } catch (error) {
    throw new EuSubmissionError(
      "failed",
      error instanceof Error ? error.message : "EU adapter configuration is invalid.",
      { cause: error },
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), adapterConfig.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImplementation(endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "urn:eu:eudr:v3/SubmitDDS",
          ...(username ? {
            Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
          } : {}),
        },
        body: buildDdsEnvelope(payload, clientId),
      });
    } catch (error) {
      throw new EuSubmissionError(
        "uncertain",
        "The EU submission transport ended without a definitive response.",
        { cause: error },
      );
    }
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw new EuSubmissionError(
        "uncertain",
        "The EU response could not be read completely.",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new EuSubmissionError(
        response.status >= 500 ? "uncertain" : "failed",
        `EU EUDR service returned HTTP ${response.status}.`,
      );
    }
    const reference = parseReference(body);
    if (!reference) {
      throw new EuSubmissionError(
        "uncertain",
        "EU EUDR response did not contain a reference.",
      );
    }
    return { reference, mock: false };
  } finally {
    clearTimeout(timeout);
  }
}

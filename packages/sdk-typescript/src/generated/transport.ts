/* Generated transport boundary for the Release 0.1 OpenAPI contract. */
import type { ApiErrorResponse, PublicErrorCode } from "./types.js";

export type ValueProvider =
  string | undefined | (() => string | undefined | Promise<string | undefined>);
export interface TransportConfiguration {
  baseUrl: string;
  accessToken?: ValueProvider;
  applicationId?: ValueProvider;
  workspaceId?: ValueProvider;
  csrfToken?: ValueProvider;
  credentials?: RequestCredentials;
  fetch?: typeof globalThis.fetch;
}
export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  public?: boolean;
}

export class TrustApiError extends Error {
  readonly status: number;
  readonly code: PublicErrorCode;
  readonly requestId: string | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  constructor(status: number, error: ApiErrorResponse) {
    super(error.message);
    this.name = "TrustApiError";
    this.status = status;
    this.code = error.code;
    this.requestId = error.requestId;
    this.details = error.details;
  }
}

export interface TrustTransport {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  requestBinary(
    path: string,
    options?: RequestOptions,
  ): Promise<BinaryResponse>;
  url(path: string): string;
}
export interface BinaryResponse {
  bytes: Uint8Array;
  headers: Headers;
}

export function createTransport(
  configuration: TransportConfiguration,
): TrustTransport {
  const baseUrl = configuration.baseUrl.replace(/\/$/, "");
  const fetchImplementation = configuration.fetch ?? globalThis.fetch;
  if (!fetchImplementation)
    throw new Error("A Fetch API implementation is required.");
  const url = (path: string) =>
    `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  return {
    url,
    async request<T>(path: string, options: RequestOptions = {}) {
      const method = options.method ?? "GET";
      const mutation = method !== "GET";
      const [token, workspaceId, applicationId, csrfToken] = await Promise.all([
        resolveValue(configuration.accessToken),
        resolveValue(configuration.workspaceId),
        resolveValue(configuration.applicationId),
        resolveValue(configuration.csrfToken),
      ]);
      const headers: Record<string, string> = {
        accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(!options.public && token
          ? { authorization: `Bearer ${token}` }
          : {}),
        ...(!options.public && workspaceId
          ? { "x-trust-workspace-id": workspaceId }
          : {}),
        ...(!options.public && applicationId
          ? { "x-trust-application-id": applicationId }
          : {}),
        ...(mutation && csrfToken ? { "x-trust-csrf": csrfToken } : {}),
        ...options.headers,
      };
      const response = await fetchImplementation(url(path), {
        method,
        credentials: configuration.credentials ?? "include",
        headers,
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
      if (!response.ok) {
        const fallback: ApiErrorResponse = {
          code: "TRUST_STORE_UNAVAILABLE",
          message: `Request failed (${response.status}).`,
        };
        const error = (await response
          .json()
          .catch(() => fallback)) as ApiErrorResponse;
        throw new TrustApiError(response.status, error);
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    },
    async requestBinary(path: string, options: RequestOptions = {}) {
      const method = options.method ?? "GET";
      const [token, workspaceId, applicationId, csrfToken] = await Promise.all([
        resolveValue(configuration.accessToken),
        resolveValue(configuration.workspaceId),
        resolveValue(configuration.applicationId),
        resolveValue(configuration.csrfToken),
      ]);
      const response = await fetchImplementation(url(path), {
        method,
        credentials: configuration.credentials ?? "include",
        headers: {
          accept: "application/vnd.trust-core.archive+zip",
          ...(!options.public && token
            ? { authorization: `Bearer ${token}` }
            : {}),
          ...(!options.public && workspaceId
            ? { "x-trust-workspace-id": workspaceId }
            : {}),
          ...(!options.public && applicationId
            ? { "x-trust-application-id": applicationId }
            : {}),
          ...(method !== "GET" && csrfToken
            ? { "x-trust-csrf": csrfToken }
            : {}),
          ...options.headers,
        },
      });
      if (!response.ok) {
        const fallback: ApiErrorResponse = {
          code: "TRUST_STORE_UNAVAILABLE",
          message: `Request failed (${response.status}).`,
        };
        const error = (await response
          .json()
          .catch(() => fallback)) as ApiErrorResponse;
        throw new TrustApiError(response.status, error);
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        headers: response.headers,
      };
    },
  };
}

async function resolveValue(value: ValueProvider): Promise<string | undefined> {
  return typeof value === "function" ? await value() : value;
}

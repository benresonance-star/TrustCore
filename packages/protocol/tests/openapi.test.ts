import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { release01OpenApi, release01Routes } from "../src/index.js";

interface OpenApiParameter {
  readonly name: string;
  readonly in: string;
  readonly required: boolean;
}

interface OpenApiOperation {
  readonly operationId: string;
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: {
    readonly content: {
      readonly "application/json": {
        readonly schema: { readonly $ref: string };
      };
    };
  };
  readonly security: readonly Readonly<Record<string, readonly unknown[]>>[];
}

const documentedOperations = () =>
  Object.entries(release01OpenApi.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]) => ({
      method: method.toUpperCase(),
      path,
      operation: operation as OpenApiOperation,
    })),
  );

describe("Release 0.1 generated OpenAPI", () => {
  it("matches the committed generated artifact", async () => {
    const artifact = JSON.parse(
      await readFile(
        resolve(process.cwd(), "../../contracts/openapi.json"),
        "utf8",
      ),
    ) as unknown;
    expect(artifact).toEqual(release01OpenApi);
  });

  it("contains exactly the shared route registry with unique IDs", () => {
    const documented = documentedOperations().map(
      ({ method, path, operation }) => ({
        method,
        path,
        operationId: operation.operationId,
      }),
    );
    expect(documented).toEqual(release01Routes);
    expect(new Set(documented.map((route) => route.operationId)).size).toBe(
      documented.length,
    );
  });

  it("declares OpenAPI 3.1 auth and stable errors", () => {
    expect(release01OpenApi.openapi).toBe("3.1.0");
    expect(release01OpenApi.components.securitySchemes).toMatchObject({
      bearerAuth: { scheme: "bearer" },
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "trust_session",
      },
      csrfToken: {
        type: "apiKey",
        in: "header",
        name: "x-trust-csrf",
      },
    });
    expect(
      release01OpenApi.components.responses.Error.content["application/json"]
        .schema,
    ).toEqual({ $ref: "#/components/schemas/ApiError" });
  });

  it("documents application-originated audit events", () => {
    expect(
      release01OpenApi.components.schemas.AuditEvent.properties.actorType.enum,
    ).toContain("application");
  });

  it("requires CSRF together with cookie auth only for mutations", () => {
    const operations = documentedOperations();
    for (const { method, path, operation } of operations) {
      if (operation.security.length === 0) continue;
      const sessionAlternatives = operation.security.filter(
        (requirement) => "sessionCookie" in requirement,
      );
      if (method === "GET") {
        expect(sessionAlternatives, `${method} ${path}`).toContainEqual({
          sessionCookie: [],
        });
        continue;
      }
      if (operation.operationId === "auth.sessionCreate") continue;
      expect(sessionAlternatives, `${method} ${path}`).toContainEqual({
        sessionCookie: [],
        csrfToken: [],
      });
      expect(sessionAlternatives, `${method} ${path}`).not.toContainEqual({
        sessionCookie: [],
      });
    }
  });

  it("documents the runtime workspace header-or-body requirement", () => {
    const securedWorkspaceOperations = documentedOperations().filter(
      ({ path }) => path.startsWith("/v1/") && !path.startsWith("/v1/auth/"),
    );
    for (const { method, path, operation } of securedWorkspaceOperations) {
      const workspaceHeader = operation.parameters?.find(
        ({ name, in: location }) =>
          name === "x-trust-workspace-id" && location === "header",
      );
      expect(workspaceHeader, `${method} ${path}`).toBeDefined();
      if (!operation.requestBody) {
        expect(workspaceHeader?.required, `${method} ${path}`).toBe(true);
        continue;
      }
      expect(workspaceHeader?.required, `${method} ${path}`).toBe(false);
      const schemaName =
        operation.requestBody.content["application/json"].schema.$ref.split(
          "/",
        ).at(-1);
      const schema =
        release01OpenApi.components.schemas[
          schemaName as keyof typeof release01OpenApi.components.schemas
        ];
      expect(schema?.required, `${method} ${path}`).toContain("workspaceId");
    }
  });
});

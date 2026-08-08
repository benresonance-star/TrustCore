import { describe, expect, it } from "vitest";
import { S3TransferSigner } from "../src/s3-transfer-signer.js";

describe("S3TransferSigner", () => {
  it("fails closed on incomplete static credentials", () => {
    expect(
      () =>
        new S3TransferSigner({
          region: "us-east-1",
          bucket: "bucket",
          accessKeyId: "only-access",
        }),
    ).toThrow(/both accessKeyId and secretAccessKey/);
  });

  it("signs upload and download urls without leaking bucket into headers", async () => {
    const signer = new S3TransferSigner({
      region: "us-east-1",
      bucket: "trust-core-local",
      endpoint: "http://127.0.0.1:5900",
      forcePathStyle: true,
      accessKeyId: "trustcore",
      secretAccessKey: "trustcore-local-secret",
    });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const upload = await signer.signUpload({
      storageKey: "workspaces/workspace_1/temporary/op_1",
      expiresAt,
      mediaType: "text/plain",
    });
    const download = await signer.signDownload({
      storageKey: `workspaces/workspace_1/objects/ab/${"a".repeat(64)}`,
      expiresAt,
      fileName: "drawing.pdf",
    });
    expect(upload.url).toContain("http://127.0.0.1:5900");
    expect(upload.headers["content-type"]).toBe("text/plain");
    expect(download.url).toContain("X-Amz-Signature");
    expect(JSON.stringify(download.headers)).not.toContain("trustcore-local-secret");
  });
});

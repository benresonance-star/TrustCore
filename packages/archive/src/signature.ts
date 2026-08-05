import { Buffer } from "node:buffer";
import { canonicalJson, sha256 } from "./canonical.js";
import type {
  ArchiveEntrySet,
  ArchiveIssue,
  ArchiveManifestSignature,
  ArchiveManifestSigner,
  ArchiveManifestVerifier,
  TrustArchiveManifest,
} from "./types.js";

export const manifestSignaturePath = "signatures/manifest-signature.json";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function signArchiveEntries(
  archive: ArchiveEntrySet,
  signer: ArchiveManifestSigner,
): Promise<ArchiveEntrySet> {
  if (
    archive.manifest.formatVersion !== "0.2" ||
    archive.manifest.signatureProfile !== "unsigned"
  )
    throw new Error("Only an unsigned Trust Archive 0.2 manifest can be signed.");
  if (signer.algorithm !== "Ed25519")
    throw new Error("Unsupported archive signature algorithm.");
  if (!validKeyId(signer.keyId))
    throw new Error("Archive signature key ID is invalid.");

  const manifest: TrustArchiveManifest = {
    ...archive.manifest,
    formatVersion: "0.3",
    signatureProfile: {
      name: "trust-core-manifest-signature-v1",
      algorithm: signer.algorithm,
      keyId: signer.keyId,
    },
  };
  const manifestBytes = encoder.encode(`${canonicalJson(manifest)}\n`);
  const entries = new Map(archive.entries);
  entries.set("manifest.json", manifestBytes);
  const checksumBytes = checksumFile(entries);
  entries.set("checksums/sha256sums.txt", checksumBytes);
  const signatureBytes = await signer.signManifest(
    signaturePayload(manifestBytes, checksumBytes),
  );
  if (signatureBytes.byteLength === 0)
    throw new Error("Archive signer returned an empty signature.");
  const artifact: ArchiveManifestSignature = {
    profile: "trust-core-manifest-signature-v1",
    algorithm: signer.algorithm,
    keyId: signer.keyId,
    signedEntries: ["manifest.json", "checksums/sha256sums.txt"],
    signatureEncoding: "base64",
    signature: Buffer.from(signatureBytes).toString("base64"),
  };

  entries.set(
    manifestSignaturePath,
    encoder.encode(`${canonicalJson(artifact)}\n`),
  );
  return { entries, manifest };
}

export async function verifyManifestSignature(
  entries: ReadonlyMap<string, Uint8Array>,
  manifest: TrustArchiveManifest,
  verifier: ArchiveManifestVerifier,
  issues: ArchiveIssue[],
): Promise<void> {
  const artifactBytes = entries.get(manifestSignaturePath);
  if (manifest.signatureProfile === "unsigned") {
    if (artifactBytes)
      addIssue(
        issues,
        "ARCHIVE_SIGNATURE_UNEXPECTED",
        "Unsigned archive contains a manifest signature artifact.",
      );
    return;
  }
  if (
    manifest.signatureProfile.name !== "trust-core-manifest-signature-v1" ||
    manifest.signatureProfile.algorithm !== "Ed25519"
  ) {
    addIssue(
      issues,
      "ARCHIVE_SIGNATURE_PROFILE_UNKNOWN",
      "Archive signature profile or algorithm is not supported.",
    );
    return;
  }
  if (!artifactBytes) {
    addIssue(
      issues,
      "ARCHIVE_SIGNATURE_MISSING",
      "Signed archive is missing its manifest signature artifact.",
    );
    return;
  }

  const artifact = readSignatureArtifact(artifactBytes, issues);
  if (!artifact) return;
  const profile = manifest.signatureProfile;
  if (
    artifact.profile !== profile.name ||
    artifact.algorithm !== profile.algorithm ||
    artifact.keyId !== profile.keyId
  ) {
    addIssue(
      issues,
      "ARCHIVE_SIGNATURE_PROFILE_MISMATCH",
      "Signature artifact does not match the manifest signature profile.",
    );
    return;
  }
  const manifestBytes = entries.get("manifest.json");
  const checksumBytes = entries.get("checksums/sha256sums.txt");
  if (!manifestBytes || !checksumBytes) return;
  const signature = decodeBase64(artifact.signature);
  if (!signature) {
    addIssue(
      issues,
      "ARCHIVE_SIGNATURE_ARTIFACT_INVALID",
      "Manifest signature is not canonical base64.",
    );
    return;
  }
  const result = await verifier.verifyManifest({
    algorithm: profile.algorithm,
    keyId: profile.keyId,
    manifestBytes: signaturePayload(manifestBytes, checksumBytes),
    signature,
  });
  if (result === "unknown_key")
    addIssue(
      issues,
      "ARCHIVE_SIGNATURE_KEY_UNKNOWN",
      "Manifest signature key is not available.",
    );
  else if (result === "invalid")
    addIssue(
      issues,
      "ARCHIVE_SIGNATURE_INVALID",
      "Manifest signature verification failed.",
    );
}

function readSignatureArtifact(
  bytes: Uint8Array,
  issues: ArchiveIssue[],
): ArchiveManifestSignature | undefined {
  try {
    const value = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
    const expectedKeys = [
      "algorithm",
      "keyId",
      "profile",
      "signature",
      "signatureEncoding",
      "signedEntries",
    ];
    if (
      Object.keys(value).sort().join(",") !== expectedKeys.join(",") ||
      value.profile !== "trust-core-manifest-signature-v1" ||
      value.algorithm !== "Ed25519" ||
      !validKeyId(value.keyId) ||
      !Array.isArray(value.signedEntries) ||
      value.signedEntries.length !== 2 ||
      value.signedEntries[0] !== "manifest.json" ||
      value.signedEntries[1] !== "checksums/sha256sums.txt" ||
      value.signatureEncoding !== "base64" ||
      typeof value.signature !== "string"
    )
      throw new Error();
    return value as unknown as ArchiveManifestSignature;
  } catch {
    addIssue(
      issues,
      "ARCHIVE_SIGNATURE_ARTIFACT_INVALID",
      "Manifest signature artifact is invalid.",
    );
    return undefined;
  }
}

function checksumFile(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const lines = [...entries]
    .filter(
      ([path]) =>
        path !== "checksums/sha256sums.txt" && !path.startsWith("signatures/"),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => `${sha256(bytes)}  ${path}`)
    .join("\n");
  return encoder.encode(`${lines}\n`);
}

function signaturePayload(
  manifestBytes: Uint8Array,
  checksumBytes: Uint8Array,
): Uint8Array {
  return encoder.encode(
    `${canonicalJson({
      checksumsSha256: sha256(checksumBytes),
      manifestSha256: sha256(manifestBytes),
      profile: "trust-core-manifest-signature-v1",
    })}\n`,
  );
}

function decodeBase64(value: string): Uint8Array | undefined {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    return undefined;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value
    ? Uint8Array.from(decoded)
    : undefined;
}

function validKeyId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[A-Za-z0-9._:/@-]+$/.test(value)
  );
}

function addIssue(issues: ArchiveIssue[], code: string, message: string): void {
  issues.push({ code, message, path: manifestSignaturePath });
}

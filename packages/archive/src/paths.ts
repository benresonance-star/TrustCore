const SHA256 = /^[a-f0-9]{64}$/;

export function assertSafeArchivePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > 512 ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  )
    throw new Error(`Unsafe archive path: ${path}`);
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    throw new Error(`Unsafe archive path: ${path}`);
}

export function blobArchivePath(digest: string): string {
  if (!SHA256.test(digest)) throw new Error("Blob SHA-256 is invalid.");
  return `blobs/${digest.slice(0, 2)}/${digest}`;
}

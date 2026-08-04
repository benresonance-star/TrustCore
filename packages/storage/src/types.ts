import type { Readable } from "node:stream";

export interface ObjectLocator { key: string }
export interface TemporaryObject extends ObjectLocator { expiresAt: string }
export interface ObjectMetadata { key: string; byteLength: number; mediaType: string; sha256?: string }
export interface StoredObject extends ObjectMetadata { etag?: string }

export interface ObjectStorage {
  createTemporaryUpload(input: { workspaceId: string; operationId: string }): Promise<TemporaryObject>;
  writeTemporary(input: { locator: ObjectLocator; body: Readable; mediaType: string }): Promise<ObjectMetadata>;
  commitImmutable(input: { temporary: ObjectLocator; workspaceId: string; sha256: string; byteLength: number; mediaType: string }): Promise<StoredObject>;
  openReadStream(input: ObjectLocator): Promise<Readable>;
  head(input: ObjectLocator): Promise<ObjectMetadata>;
  exists(input: ObjectLocator): Promise<boolean>;
  deleteTemporary(input: ObjectLocator): Promise<void>;
}

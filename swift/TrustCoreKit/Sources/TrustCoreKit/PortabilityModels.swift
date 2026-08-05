import Foundation

public struct ArchiveCandidate: Codable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let exportId: String
    public let status: String
    public let checkedEntries: Int
    public let issueCount: Int
    public let recordCounts: [String: Int]
    public let blobCount: Int
    public let totalBlobBytes: Int
    public let createdAt: String
}

public struct ArchiveExport: Codable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let datasetIds: [String]
    public let status: String
    public let sha256: String
    public let byteLength: Int
    public let createdAt: String
}

public struct ArchiveDownload: Codable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let datasetIds: [String]
    public let status: String
    public let sha256: String
    public let byteLength: Int
    public let createdAt: String
    public let mediaType: String
    public let filename: String
    public let archiveBase64: String

    public var archiveData: Data? { Data(base64Encoded: archiveBase64) }
}

public struct ImportPlan: Codable, Equatable, Sendable {
    public let id: String
    public let archiveId: String
    public let workspaceId: String
    public let sourceWorkspaceId: String
    public let mode: String
    public let conflictMode: String
    public let status: String
    public let issueCount: Int
    public let counts: [String: Int]
    public let createdAt: String
}

public struct ImportOperation: Codable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let planId: String
    public let archiveId: String
    public let checkpoint: String
    public let status: String
    public let resumed: Bool
    public let updatedAt: String
    public let completedAt: String?
}

public enum ArchiveImportMode: String, Codable, Sendable {
    case preserveIDs = "preserve_ids"
    case mappedWorkspace = "mapped_workspace"
}

public enum ArchiveConflictMode: String, Codable, Sendable {
    case rejectOnError = "reject_on_error"
    case reportOnly = "report_only"
}

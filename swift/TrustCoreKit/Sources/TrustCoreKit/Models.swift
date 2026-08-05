import Foundation

public struct ListResponse<Item: Codable & Sendable>: Codable, Sendable {
    public let items: [Item]
    public let nextCursor: String?

    public init(items: [Item], nextCursor: String? = nil) {
        self.items = items
        self.nextCursor = nextCursor
    }
}

public struct RequestContext: Sendable {
    public var workspaceID: String?
    public var datasetID: String?
    public var applicationID: String?

    public init(workspaceID: String? = nil, datasetID: String? = nil, applicationID: String? = nil) {
        self.workspaceID = workspaceID
        self.datasetID = datasetID
        self.applicationID = applicationID
    }
}

public struct Dataset: Codable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let schemaPackageId: String
    public let datasetType: String
    public let name: String
    public let status: String
    public let retentionPolicyId: String?
    public let createdAt: String
    public let updatedAt: String

    public init(id: String, workspaceId: String, schemaPackageId: String, datasetType: String, name: String, status: String, retentionPolicyId: String? = nil, createdAt: String, updatedAt: String) {
        self.id = id
        self.workspaceId = workspaceId
        self.schemaPackageId = schemaPackageId
        self.datasetType = datasetType
        self.name = name
        self.status = status
        self.retentionPolicyId = retentionPolicyId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct Resource: Codable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let datasetId: String
    public let resourceType: String
    public let title: String?
    public let status: String
    public let currentRevisionId: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct Revision: Codable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let datasetId: String
    public let resourceId: String
    public let revisionNumber: Int
    public let parentRevisionId: String?
    public let mergeParentRevisionIds: [String]
    public let schemaPackageId: String
    public let schemaVersion: String
    public let canonicalPayload: JSONObject
    public let canonicalPayloadHash: String
    public let createdBy: String
    public let source: String
    public let changeNote: String?
    public let restoredFromRevisionId: String?
    public let createdAt: String
}

public struct RevisionGraph: Codable, Equatable, Sendable {
    public let resourceId: String
    public let headRevisionId: String?
    public let revisions: [Revision]
}

public struct CreateRevision: Codable, Equatable, Sendable {
    public let expectedRevisionId: String?
    public let schemaPackageId: String
    public let schemaVersion: String
    public let canonicalPayload: JSONObject
    public let changeNote: String?

    public init(expectedRevisionId: String?, schemaPackageId: String, schemaVersion: String, canonicalPayload: JSONObject, changeNote: String? = nil) {
        self.expectedRevisionId = expectedRevisionId
        self.schemaPackageId = schemaPackageId
        self.schemaVersion = schemaVersion
        self.canonicalPayload = canonicalPayload
        self.changeNote = changeNote
    }
}

public struct RevisionResult: Codable, Equatable, Sendable {
    public let resourceId: String
    public let revisionId: String
    public let revisionNumber: Int
    public let source: String
    public let createdAt: String
}

public struct DeleteResource: Codable, Equatable, Sendable {
    public let expectedRevisionId: String?
    public let recoverUntil: String?
    public let reason: String?

    public init(expectedRevisionId: String?, recoverUntil: String?, reason: String? = nil) {
        self.expectedRevisionId = expectedRevisionId
        self.recoverUntil = recoverUntil
        self.reason = reason
    }
}

public struct DeleteResourceResult: Codable, Equatable, Sendable {
    public let resourceId: String
    public let tombstoneId: String
    public let deletedAt: String
    public let recoverUntil: String?
}

public struct RestoreResource: Codable, Equatable, Sendable {
    public let changeNote: String?

    public init(changeNote: String? = nil) {
        self.changeNote = changeNote
    }
}

public struct RecoverableItem: Codable, Equatable, Sendable {
    public let tombstoneId: String
    public let workspaceId: String
    public let datasetId: String
    public let resourceId: String
    public let resourceTitle: String?
    public let resourceType: String
    public let deletedAt: String
    public let recoverUntil: String?
    public let deletedBy: String
    public let priorRevisionId: String?
}

public struct TrustEvent: Codable, Equatable, Sendable {
    public let id: String
    public let action: String
    public let subjectId: String
    public let actorId: String
    public let occurredAt: String
    public let metadata: JSONObject
}

public struct HistorySnapshot: Codable, Equatable, Sendable {
    public let recoverable: [RecoverableItem]
    public let events: [TrustEvent]
}

public struct Relation: Codable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let datasetId: String
    public let sourceKind: String
    public let sourceId: String
    public let targetKind: String
    public let targetId: String
    public let relationType: String
    public let metadata: JSONObject
    public let createdBy: String
    public let createdAt: String
    public let endedAt: String?
}

public struct VerificationScope: Codable, Equatable, Sendable {
    public let kind: String
    public let id: String

    public init(kind: String, id: String) {
        self.kind = kind
        self.id = id
    }
}

public struct RunVerification: Codable, Equatable, Sendable {
    public let level: String
    public let scope: VerificationScope?

    public init(level: String, scope: VerificationScope? = nil) {
        self.level = level
        self.scope = scope
    }
}

public struct VerificationIssue: Codable, Equatable, Sendable {
    public let code: String
    public let severity: String
    public let subjectKind: String
    public let subjectId: String
    public let message: String
    public let expected: JSONValue?
    public let actual: JSONValue?
}

public struct VerificationRun: Codable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let level: String
    public let scope: VerificationScope
    public let status: String
    public let startedAt: String
    public let completedAt: String?
    public let objectsChecked: Int
    public let bytesRead: Int
    public let issues: [VerificationIssue]
}

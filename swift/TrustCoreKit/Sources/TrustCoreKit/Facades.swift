import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct DatasetFacade: Sendable {
    private let http: AuthenticatedHTTPClient

    init(http: AuthenticatedHTTPClient) { self.http = http }

    public func list(context: RequestContext = .init()) async throws -> ListResponse<Dataset> {
        try await http.request("/v1/datasets", context: context)
    }

    public func get(_ datasetID: String, context: RequestContext = .init()) async throws -> Dataset {
        try await http.request("/v1/datasets/\(encodedPathSegment(datasetID))", context: context)
    }

    public func relations(context: RequestContext = .init()) async throws -> ListResponse<Relation> {
        try await http.request("/v1/relations", context: context)
    }
}

public struct ResourceFacade: Sendable {
    private let http: AuthenticatedHTTPClient

    init(http: AuthenticatedHTTPClient) { self.http = http }

    public func list(context: RequestContext = .init()) async throws -> ListResponse<Resource> {
        try await http.request("/v1/resources", context: context)
    }

    public func get(_ resourceID: String, context: RequestContext = .init()) async throws -> Resource {
        try await http.request("/v1/resources/\(encodedPathSegment(resourceID))", context: context)
    }

    public func delete(_ resourceID: String, command: DeleteResource) async throws -> DeleteResourceResult {
        let body = DeleteResourceBody(
            workspaceId: try await http.workspaceID(),
            expectedRevisionId: command.expectedRevisionId,
            recoverUntil: command.recoverUntil,
            reason: command.reason
        )
        return try await http.request(
            "/v1/resources/\(encodedPathSegment(resourceID))/delete",
            method: "POST",
            body: body
        )
    }

    public func restore(_ resourceID: String, command: RestoreResource = .init()) async throws -> RevisionResult {
        let body = RestoreResourceBody(workspaceId: try await http.workspaceID(), changeNote: command.changeNote)
        return try await http.request(
            "/v1/resources/\(encodedPathSegment(resourceID))/restore",
            method: "POST",
            body: body
        )
    }
}

public struct RevisionFacade: Sendable {
    private let http: AuthenticatedHTTPClient

    init(http: AuthenticatedHTTPClient) { self.http = http }

    public func graph(resourceID: String, context: RequestContext = .init()) async throws -> RevisionGraph {
        try await http.request(
            "/v1/resources/\(encodedPathSegment(resourceID))/revision-graph",
            context: context
        )
    }

    public func create(resourceID: String, command: CreateRevision) async throws -> RevisionResult {
        let body = CreateRevisionBody(
            workspaceId: try await http.workspaceID(),
            expectedRevisionId: command.expectedRevisionId,
            schemaPackageId: command.schemaPackageId,
            schemaVersion: command.schemaVersion,
            canonicalPayload: command.canonicalPayload,
            changeNote: command.changeNote
        )
        return try await http.request(
            "/v1/resources/\(encodedPathSegment(resourceID))/revisions",
            method: "POST",
            body: body
        )
    }
}

public struct HistoryFacade: Sendable {
    private let http: AuthenticatedHTTPClient

    init(http: AuthenticatedHTTPClient) { self.http = http }

    public func list(context: RequestContext = .init()) async throws -> HistorySnapshot {
        try await http.request("/v1/history", context: context)
    }
}

public struct VerificationFacade: Sendable {
    private let http: AuthenticatedHTTPClient

    init(http: AuthenticatedHTTPClient) { self.http = http }

    public func run(_ command: RunVerification) async throws -> VerificationRun {
        let body = RunVerificationBody(
            workspaceId: try await http.workspaceID(),
            level: command.level,
            scope: command.scope
        )
        return try await http.request("/v1/verification/runs", method: "POST", body: body)
    }

    public func list(context: RequestContext = .init()) async throws -> ListResponse<VerificationRun> {
        try await http.request("/v1/verification/reports", context: context)
    }

    public func get(_ reportID: String, context: RequestContext = .init()) async throws -> VerificationRun {
        try await http.request(
            "/v1/verification/reports/\(encodedPathSegment(reportID))",
            context: context
        )
    }
}

public struct PortabilityFacade: Sendable {
    private let http: AuthenticatedHTTPClient

    init(http: AuthenticatedHTTPClient) { self.http = http }

    public func createExport(
        datasetIDs: [String],
        reauthenticationProof: String,
        idempotencyKey: String = IdempotencyKey.make(prefix: "export")
    ) async throws -> ArchiveExport {
        let body = CreateExportBody(
            workspaceId: try await http.workspaceID(),
            datasetIds: datasetIDs,
            idempotencyKey: idempotencyKey
        )
        return try await http.request(
            "/v1/portability/exports",
            method: "POST",
            body: body,
            additionalHeaders: ["x-trust-reauth": reauthenticationProof]
        )
    }

    public func downloadExport(_ exportID: String, reauthenticationProof: String) async throws -> ArchiveDownload {
        try await http.request(
            "/v1/portability/exports/\(encodedPathSegment(exportID))/download",
            additionalHeaders: ["x-trust-reauth": reauthenticationProof]
        )
    }

    public func uploadArchive(
        _ data: Data,
        idempotencyKey: String = IdempotencyKey.make(prefix: "archive")
    ) async throws -> ArchiveCandidate {
        let body = UploadArchiveBody(
            workspaceId: try await http.workspaceID(),
            idempotencyKey: idempotencyKey,
            archiveBase64: data.base64EncodedString()
        )
        return try await http.request("/v1/portability/archives", method: "POST", body: body)
    }

    public func archive(_ archiveID: String) async throws -> ArchiveCandidate {
        try await http.request("/v1/portability/archives/\(encodedPathSegment(archiveID))")
    }

    public func createImportPlan(
        archiveID: String,
        mode: ArchiveImportMode,
        conflictMode: ArchiveConflictMode,
        idempotencyKey: String = IdempotencyKey.make(prefix: "plan")
    ) async throws -> ImportPlan {
        let body = CreateImportPlanBody(
            workspaceId: try await http.workspaceID(),
            archiveId: archiveID,
            idempotencyKey: idempotencyKey,
            mode: mode,
            conflictMode: conflictMode
        )
        return try await http.request("/v1/portability/plans", method: "POST", body: body)
    }

    public func importPlan(_ planID: String) async throws -> ImportPlan {
        try await http.request("/v1/portability/plans/\(encodedPathSegment(planID))")
    }

    public func executeImportPlan(
        _ planID: String,
        reauthenticationProof: String,
        idempotencyKey: String = IdempotencyKey.make(prefix: "import")
    ) async throws -> ImportOperation {
        let body = ExecuteImportBody(
            workspaceId: try await http.workspaceID(),
            idempotencyKey: idempotencyKey,
            confirmation: "IMPORT"
        )
        return try await http.request(
            "/v1/portability/plans/\(encodedPathSegment(planID))/execute",
            method: "POST",
            body: body,
            additionalHeaders: ["x-trust-reauth": reauthenticationProof]
        )
    }

    public func importOperation(_ operationID: String) async throws -> ImportOperation {
        try await http.request("/v1/portability/operations/\(encodedPathSegment(operationID))")
    }
}

public final class TrustCoreClient: @unchecked Sendable {
    public let datasets: DatasetFacade
    public let resources: ResourceFacade
    public let revisions: RevisionFacade
    public let history: HistoryFacade
    public let verification: VerificationFacade
    public let portability: PortabilityFacade

    public init(configuration: TrustCoreConfiguration, session: URLSession = .shared) {
        let http = AuthenticatedHTTPClient(configuration: configuration, session: session)
        self.datasets = DatasetFacade(http: http)
        self.resources = ResourceFacade(http: http)
        self.revisions = RevisionFacade(http: http)
        self.history = HistoryFacade(http: http)
        self.verification = VerificationFacade(http: http)
        self.portability = PortabilityFacade(http: http)
    }
}

private struct DeleteResourceBody: Encodable, Sendable {
    let workspaceId: String
    let expectedRevisionId: String?
    let recoverUntil: String?
    let reason: String?
}

private struct RestoreResourceBody: Encodable, Sendable {
    let workspaceId: String
    let changeNote: String?
}

private struct CreateRevisionBody: Encodable, Sendable {
    let workspaceId: String
    let expectedRevisionId: String?
    let schemaPackageId: String
    let schemaVersion: String
    let canonicalPayload: JSONObject
    let changeNote: String?
}

private struct RunVerificationBody: Encodable, Sendable {
    let workspaceId: String
    let level: String
    let scope: VerificationScope?
}

private struct CreateExportBody: Encodable, Sendable {
    let workspaceId: String
    let datasetIds: [String]
    let idempotencyKey: String
}

private struct UploadArchiveBody: Encodable, Sendable {
    let workspaceId: String
    let idempotencyKey: String
    let archiveBase64: String
}

private struct CreateImportPlanBody: Encodable, Sendable {
    let workspaceId: String
    let archiveId: String
    let idempotencyKey: String
    let mode: ArchiveImportMode
    let conflictMode: ArchiveConflictMode
}

private struct ExecuteImportBody: Encodable, Sendable {
    let workspaceId: String
    let idempotencyKey: String
    let confirmation: String
}

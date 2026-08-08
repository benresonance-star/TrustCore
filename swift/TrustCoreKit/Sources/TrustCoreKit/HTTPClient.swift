import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public typealias TrustValueProvider = @Sendable () async throws -> String?

public struct TrustCoreConfiguration: Sendable {
    public let baseURL: URL
    public let accessToken: TrustValueProvider?
    public let workspaceID: TrustValueProvider?
    public let applicationID: TrustValueProvider?
    public let csrfToken: TrustValueProvider?

    public init(
        baseURL: URL,
        accessToken: TrustValueProvider? = nil,
        workspaceID: TrustValueProvider? = nil,
        applicationID: TrustValueProvider? = nil,
        csrfToken: TrustValueProvider? = nil
    ) {
        self.baseURL = baseURL
        self.accessToken = accessToken
        self.workspaceID = workspaceID
        self.applicationID = applicationID
        self.csrfToken = csrfToken
    }

    public init(baseURL: URL, accessToken: String?, workspaceID: String? = nil, applicationID: String? = nil, csrfToken: String? = nil) {
        self.init(
            baseURL: baseURL,
            accessToken: { accessToken },
            workspaceID: { workspaceID },
            applicationID: { applicationID },
            csrfToken: { csrfToken }
        )
    }
}

public final class AuthenticatedHTTPClient: @unchecked Sendable {
    private let configuration: TrustCoreConfiguration
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(configuration: TrustCoreConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    func workspaceID() async throws -> String {
        guard let workspaceID = try await resolve(configuration.workspaceID), !workspaceID.isEmpty else {
            throw TrustCoreError.invalidConfiguration("A workspace ID is required for this operation.")
        }
        return workspaceID
    }

    func request<Response: Decodable & Sendable>(
        _ path: String,
        method: String = "GET",
        context: RequestContext = .init(),
        body: (any Encodable & Sendable)? = nil,
        requiresAuthentication: Bool = true,
        additionalHeaders: [String: String] = [:]
    ) async throws -> Response {
        let data = try await perform(
            path,
            method: method,
            context: context,
            body: body,
            requiresAuthentication: requiresAuthentication,
            additionalHeaders: additionalHeaders
        )
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw TrustCoreError.decoding("Could not decode \(Response.self): \(error)")
        }
    }

    func requestWithoutResponse(
        _ path: String,
        method: String,
        context: RequestContext = .init(),
        body: (any Encodable & Sendable)? = nil
    ) async throws {
        _ = try await perform(path, method: method, context: context, body: body, requiresAuthentication: true)
    }

    private func perform(
        _ path: String,
        method: String,
        context: RequestContext,
        body: (any Encodable & Sendable)?,
        requiresAuthentication: Bool,
        additionalHeaders: [String: String] = [:]
    ) async throws -> Data {
        let baseURL = configuration.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(baseURL)/\(normalizedPath(path))") else {
            throw TrustCoreError.invalidConfiguration("The API path is invalid.")
        }
        async let suppliedToken: String? = resolve(configuration.accessToken)
        async let suppliedWorkspace: String? = resolve(configuration.workspaceID)
        async let suppliedApplication: String? = resolve(configuration.applicationID)
        async let suppliedCSRF: String? = resolve(configuration.csrfToken)
        let (token, configuredWorkspace, configuredApplication, csrf) = try await (
            suppliedToken,
            suppliedWorkspace,
            suppliedApplication,
            suppliedCSRF
        )
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token, requiresAuthentication {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let workspace = context.workspaceID ?? configuredWorkspace {
            request.setValue(workspace, forHTTPHeaderField: "x-trust-workspace-id")
        }
        if let dataset = context.datasetID {
            request.setValue(dataset, forHTTPHeaderField: "x-trust-dataset-id")
        }
        if let application = context.applicationID ?? configuredApplication {
            request.setValue(application, forHTTPHeaderField: "x-trust-application-id")
        }
        if method != "GET", let csrf {
            request.setValue(csrf, forHTTPHeaderField: "x-trust-csrf")
        }
        for (name, value) in additionalHeaders {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let body {
            request.httpBody = try encoder.encode(AnyEncodable(body))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw TrustCoreError.transport(error.localizedDescription)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw TrustCoreError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let fallback = APIErrorResponse(
                code: "TRUST_STORE_UNAVAILABLE",
                message: "Request failed (\(httpResponse.statusCode)).",
                details: nil,
                requestId: nil
            )
            throw TrustCoreError.api(
                statusCode: httpResponse.statusCode,
                response: (try? decoder.decode(APIErrorResponse.self, from: data)) ?? fallback
            )
        }
        return data
    }

    private func normalizedPath(_ path: String) -> String {
        path.hasPrefix("/") ? String(path.dropFirst()) : path
    }
}

private struct AnyEncodable: Encodable, @unchecked Sendable {
    private let encodeValue: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        self.encodeValue = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try encodeValue(encoder)
    }
}

func encodedPathSegment(_ value: String) -> String {
    let unreserved = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
    return value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
}

private func resolve(_ provider: TrustValueProvider?) async throws -> String? {
    try await provider?()
}

import Foundation

public struct APIErrorResponse: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
    public let details: JSONObject?
    public let requestId: String?
}

public enum TrustCoreError: Error, Sendable {
    case invalidConfiguration(String)
    case authenticationRequired
    case invalidResponse
    case transport(String)
    case decoding(String)
    case api(statusCode: Int, response: APIErrorResponse)
    case archive(ArchiveVerificationIssue)
}

extension TrustCoreError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case let .invalidConfiguration(message), let .transport(message), let .decoding(message):
            return message
        case .authenticationRequired:
            return "Authentication is required."
        case .invalidResponse:
            return "The server returned an invalid HTTP response."
        case let .api(_, response):
            return response.message
        case let .archive(issue):
            return issue.message
        }
    }
}

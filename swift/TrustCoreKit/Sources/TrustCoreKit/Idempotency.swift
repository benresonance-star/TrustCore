import Foundation

public enum IdempotencyKey {
    public static func make(prefix: String = "request", uuid: UUID = UUID()) -> String {
        "\(sanitized(prefix))-\(uuid.uuidString.lowercased())"
    }

    /// Derives a repeatable key when the caller already has a stable operation identity.
    public static func stable(prefix: String, operationID: String) -> String {
        "\(sanitized(prefix))-\(operationID)"
    }

    private static func sanitized(_ prefix: String) -> String {
        let allowed = prefix.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        return allowed.isEmpty ? "request" : allowed
    }
}

#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
import Foundation

public enum ArchiveSignatureProfile: Codable, Equatable, Sendable {
    public struct Managed: Codable, Equatable, Sendable {
        public let name: String
        public let algorithm: String
        public let keyId: String
    }

    case unsigned
    case managed(Managed)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(String.self), value == "unsigned" {
            self = .unsigned
            return
        }
        self = .managed(try container.decode(Managed.self))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .unsigned:
            try container.encode("unsigned")
        case let .managed(profile):
            try container.encode(profile)
        }
    }
}

public struct TrustArchiveManifest: Codable, Equatable, Sendable {
    public struct AuditLineage: Codable, Equatable, Sendable {
        public let mode: String
        public let sourceWorkspaceId: String
        public let eventCount: Int
        public let firstEventHash: String?
        public let lastEventHash: String?
    }

    public let format: String
    public let formatVersion: String
    public let exportId: String
    public let workspaceId: String
    public let datasetIds: [String]
    public let createdAt: String
    public let createdBy: String
    public let sourceVersion: String
    public let checksumAlgorithm: String
    public let canonicalJsonProfile: String
    public let signatureProfile: ArchiveSignatureProfile
    public let auditLineage: AuditLineage
    public let recordCounts: [String: Int]
    public let blobCount: Int
    public let totalBlobBytes: Int
}

public protocol SHA256Verifying: Sendable {
    func digest(data: Data) -> String
    func verify(data: Data, expectedHexDigest: String) -> Bool
}

public struct CryptoKitSHA256Verifier: SHA256Verifying {
    public init() {}

    public func digest(data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    public func verify(data: Data, expectedHexDigest: String) -> Bool {
        let expected = expectedHexDigest.lowercased()
        guard expected.utf8.count == 64, expected.allSatisfy(\.isHexDigit) else { return false }
        return constantTimeEqual(digest(data: data), expected)
    }

    private func constantTimeEqual(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs.utf8)
        let right = Array(rhs.utf8)
        guard left.count == right.count else { return false }
        return zip(left, right).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }
}

public struct ArchiveVerificationIssue: Codable, Equatable, Sendable {
    public let code: String
    public let path: String?
    public let message: String

    public init(code: String, path: String? = nil, message: String) {
        self.code = code
        self.path = path
        self.message = message
    }
}

public struct ArchiveVerificationReport: Codable, Equatable, Sendable {
    public let valid: Bool
    public let checkedEntries: Int
    public let issues: [ArchiveVerificationIssue]
    public let manifest: TrustArchiveManifest?
}

/// Verifies an already-extracted logical archive entry set. ZIP64 parsing and
/// decompression limits remain the responsibility of the container adapter.
public struct TrustArchiveVerifier: Sendable {
    public static let checksumPath = "checksums/sha256sums.txt"
    private let hasher: any SHA256Verifying

    public init(hasher: any SHA256Verifying = CryptoKitSHA256Verifier()) {
        self.hasher = hasher
    }

    public func decodeManifest(from data: Data) throws -> TrustArchiveManifest {
        let manifest: TrustArchiveManifest
        do {
            manifest = try JSONDecoder().decode(TrustArchiveManifest.self, from: data)
        } catch {
            throw TrustCoreError.decoding("The trust archive manifest is invalid: \(error)")
        }
        guard manifest.format == "trustarchive",
              manifest.checksumAlgorithm == "sha256",
              manifest.canonicalJsonProfile == "trust-core-canonical-json-v1",
              manifest.auditLineage.mode == "source_chain",
              manifest.auditLineage.sourceWorkspaceId == manifest.workspaceId
        else {
            throw TrustCoreError.archive(.init(
                code: "ARCHIVE_MANIFEST_INVALID",
                path: "manifest.json",
                message: "The manifest format or verification profile is incompatible."
            ))
        }
        switch (manifest.formatVersion, manifest.signatureProfile) {
        case ("0.2", .unsigned):
            break
        case ("0.3", .managed(let profile))
            where profile.name == "trust-core-manifest-signature-v1"
                && profile.algorithm == "Ed25519"
                && !profile.keyId.isEmpty:
            break
        default:
            throw TrustCoreError.archive(.init(
                code: "ARCHIVE_SIGNATURE_PROFILE_UNKNOWN",
                path: "manifest.json",
                message: "The archive signature profile is incompatible."
            ))
        }
        return manifest
    }

    public func verify(entries: [String: Data]) -> ArchiveVerificationReport {
        var issues: [ArchiveVerificationIssue] = []
        for path in entries.keys where !Self.isSafeArchivePath(path) {
            issues.append(.init(code: "ARCHIVE_PATH_UNSAFE", path: path, message: "Archive path is unsafe."))
        }

        var manifest: TrustArchiveManifest?
        if let data = entries["manifest.json"] {
            do {
                manifest = try decodeManifest(from: data)
            } catch {
                issues.append(.init(code: "ARCHIVE_MANIFEST_INVALID", path: "manifest.json", message: error.localizedDescription))
            }
        } else {
            issues.append(.init(code: "ARCHIVE_MANIFEST_MISSING", path: "manifest.json", message: "Manifest is missing."))
        }

        guard let checksumData = entries[Self.checksumPath],
              let checksumText = String(data: checksumData, encoding: .utf8)
        else {
            issues.append(.init(code: "ARCHIVE_CHECKSUM_FILE_MISSING", path: Self.checksumPath, message: "Checksum file is missing or invalid UTF-8."))
            return .init(valid: false, checkedEntries: 0, issues: issues, manifest: manifest)
        }

        let checksums = parseChecksums(checksumText, issues: &issues)
        for (path, expectedDigest) in checksums {
            guard let data = entries[path] else {
                issues.append(.init(code: "ARCHIVE_ENTRY_MISSING", path: path, message: "Checksummed entry is missing."))
                continue
            }
            if !hasher.verify(data: data, expectedHexDigest: expectedDigest) {
                issues.append(.init(code: "ARCHIVE_CHECKSUM_INVALID", path: path, message: "Entry checksum does not match."))
            }
        }
        for path in entries.keys
        where path != Self.checksumPath && !path.hasPrefix("signatures/") && checksums[path] == nil {
            issues.append(.init(code: "ARCHIVE_ENTRY_UNCHECKED", path: path, message: "Archive entry is not checksummed."))
        }

        return .init(valid: issues.isEmpty, checkedEntries: checksums.count, issues: issues, manifest: manifest)
    }

    public static func isSafeArchivePath(_ path: String) -> Bool {
        guard !path.isEmpty,
              !path.hasPrefix("/"),
              !path.hasPrefix("\\"),
              !path.contains("\\"),
              !path.contains(":"),
              !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { return false }
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        return segments.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    private func parseChecksums(
        _ text: String,
        issues: inout [ArchiveVerificationIssue]
    ) -> [String: String] {
        var result: [String: String] = [:]
        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: true) {
            let line = rawLine.last == "\r" ? rawLine.dropLast() : rawLine[...]
            guard line.count > 66 else {
                issues.append(.init(code: "ARCHIVE_CHECKSUM_FILE_INVALID", message: "Checksum line is invalid."))
                continue
            }
            let digest = String(line.prefix(64))
            let separator = line.dropFirst(64).prefix(2)
            let path = String(line.dropFirst(66))
            guard separator == "  ",
                  digest.allSatisfy(\.isHexDigit),
                  digest == digest.lowercased(),
                  Self.isSafeArchivePath(path)
            else {
                issues.append(.init(code: "ARCHIVE_CHECKSUM_FILE_INVALID", path: path, message: "Checksum line is invalid."))
                continue
            }
            if result[path] != nil {
                issues.append(.init(code: "ARCHIVE_CHECKSUM_DUPLICATE", path: path, message: "Checksum path is duplicated."))
            } else {
                result[path] = digest
            }
        }
        return result
    }
}

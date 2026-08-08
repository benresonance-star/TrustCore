import XCTest
@testable import TrustCoreKit

final class ArchiveVerificationTests: XCTestCase {
    func testCryptoKitSHA256MatchesKnownVector() {
        let verifier = CryptoKitSHA256Verifier()
        XCTAssertEqual(
            verifier.digest(data: Data("abc".utf8)),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
    }

    func testDecodesAndVerifiesLogicalArchiveEntries() throws {
        let manifest = Data(
            """
            {
              "format":"trustarchive",
              "formatVersion":"0.2",
              "exportId":"export-1",
              "workspaceId":"workspace-1",
              "datasetIds":["dataset-1"],
              "createdAt":"2026-01-01T00:00:00.000Z",
              "createdBy":"actor-1",
              "sourceVersion":"0.4",
              "checksumAlgorithm":"sha256",
              "canonicalJsonProfile":"trust-core-canonical-json-v1",
              "signatureProfile":"unsigned",
              "auditLineage":{
                "mode":"source_chain",
                "sourceWorkspaceId":"workspace-1",
                "eventCount":0,
                "firstEventHash":null,
                "lastEventHash":null
              },
              "recordCounts":{"datasets":0},
              "blobCount":0,
              "totalBlobBytes":0
            }
            """.utf8
        )
        let readme = Data("portable synthetic fixture\n".utf8)
        let hasher = CryptoKitSHA256Verifier()
        let checksums = Data(
            """
            \(hasher.digest(data: manifest))  manifest.json
            \(hasher.digest(data: readme))  README.txt

            """.utf8
        )

        let report = TrustArchiveVerifier().verify(entries: [
            "manifest.json": manifest,
            "README.txt": readme,
            TrustArchiveVerifier.checksumPath: checksums,
        ])

        XCTAssertTrue(report.valid, "\(report.issues)")
        XCTAssertEqual(report.checkedEntries, 2)
        XCTAssertEqual(report.manifest?.exportId, "export-1")
    }

    func testRejectsTraversalAndTampering() {
        let report = TrustArchiveVerifier().verify(entries: [
            "../manifest.json": Data(),
            TrustArchiveVerifier.checksumPath: Data(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  README.txt\n".utf8
            ),
            "README.txt": Data("changed".utf8),
        ])

        XCTAssertFalse(report.valid)
        XCTAssertTrue(report.issues.contains { $0.code == "ARCHIVE_PATH_UNSAFE" })
        XCTAssertTrue(report.issues.contains { $0.code == "ARCHIVE_CHECKSUM_INVALID" })
    }
}

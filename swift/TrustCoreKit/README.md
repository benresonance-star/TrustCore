# TrustCoreKit

`TrustCoreKit` is the domain-neutral Swift client package for Trust Core Release
0.4. It wraps the public HTTP API; it does not expose database or object-storage
access.

```swift
let client = TrustCoreClient(
    configuration: TrustCoreConfiguration(
        baseURL: URL(string: "https://trust.example/api/")!,
        accessToken: { await credentials.accessToken },
        workspaceID: { workspace.id },
        applicationID: { "registered-application-id" }
    )
)

let datasets = try await client.datasets.list()
let history = try await client.history.list(
    context: RequestContext(datasetID: datasets.items.first?.id)
)
```

Mutating facades add the configured workspace identity to command bodies.
Callers may supply stable idempotency keys, or use `IdempotencyKey.make` and
`IdempotencyKey.stable`. Portability export and import execution require an
explicit, fresh reauthentication proof.

`TrustArchiveVerifier` verifies a logical, already-extracted archive entry set
against `checksums/sha256sums.txt` and decodes the 0.2 manifest.
`CryptoKitSHA256Verifier` uses Apple's CryptoKit SHA-256 implementation. A
container adapter must separately enforce strict ZIP64 parsing, traversal,
entry-size, aggregate-size and compression-ratio limits before extraction.

Run tests on a machine with an Apple Swift 5.9+ toolchain:

```sh
cd swift/TrustCoreKit
swift test
```

// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TrustCoreKit",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
        .tvOS(.v15),
        .watchOS(.v8),
    ],
    products: [
        .library(name: "TrustCoreKit", targets: ["TrustCoreKit"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-crypto.git", from: "4.5.0"),
    ],
    targets: [
        .target(
            name: "TrustCoreKit",
            dependencies: [
                .product(name: "Crypto", package: "swift-crypto"),
            ]
        ),
        .testTarget(
            name: "TrustCoreKitTests",
            dependencies: ["TrustCoreKit"],
            resources: [.process("Fixtures")]
        ),
    ]
)

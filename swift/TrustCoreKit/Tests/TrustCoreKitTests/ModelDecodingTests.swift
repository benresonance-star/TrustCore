import XCTest
@testable import TrustCoreKit

final class ModelDecodingTests: XCTestCase {
    func testDecodesTypeScriptCompatibilityFixture() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "typescript-compatibility", withExtension: "json"))
        let response = try JSONDecoder().decode(ListResponse<Dataset>.self, from: Data(contentsOf: url))

        XCTAssertEqual(response.items.map(\.id), ["dataset-ivans-diary", "dataset-wesketch"])
        XCTAssertEqual(response.items.map(\.workspaceId), ["workspace-synthetic", "workspace-synthetic"])
    }

    func testJSONValueRoundTripsUnknownFields() throws {
        let source = Data(#"{"future":{"enabled":true,"weight":1.5},"value":null}"#.utf8)
        let value = try JSONDecoder().decode(JSONObject.self, from: source)
        let encoded = try JSONEncoder().encode(value)
        let decoded = try JSONDecoder().decode(JSONObject.self, from: encoded)

        XCTAssertEqual(decoded, value)
    }
}

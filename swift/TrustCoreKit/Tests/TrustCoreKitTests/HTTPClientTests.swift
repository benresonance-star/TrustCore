import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TrustCoreKit

final class HTTPClientTests: XCTestCase {
    override func tearDown() {
        URLProtocolStub.handler = nil
        super.tearDown()
    }

    func testAuthenticatedFacadeAddsContextHeaders() async throws {
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-trust-workspace-id"), "workspace-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-trust-dataset-id"), "dataset-1")
            XCTAssertEqual(request.url?.path, "/v1/datasets")
            return Self.response(
                request,
                json: #"{"items":[]}"#
            )
        }
        let client = makeClient()
        let response = try await client.datasets.list(context: .init(datasetID: "dataset-1"))

        XCTAssertTrue(response.items.isEmpty)
    }

    func testRevisionFacadeSendsWorkspaceCommandAndEscapesIdentifier() async throws {
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertTrue(request.url?.absoluteString.contains("resource%2Fone/revisions") == true)
            let body = try XCTUnwrap(request.httpBody)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(object["workspaceId"] as? String, "workspace-1")
            XCTAssertEqual(object["schemaPackageId"] as? String, "schema-1")
            return Self.response(
                request,
                json: #"{"resourceId":"resource/one","revisionId":"revision-2","revisionNumber":2,"source":"application","createdAt":"2026-01-01T00:00:00.000Z"}"#
            )
        }
        let result = try await makeClient().revisions.create(
            resourceID: "resource/one",
            command: .init(
                expectedRevisionId: "revision-1",
                schemaPackageId: "schema-1",
                schemaVersion: "1.0.0",
                canonicalPayload: ["value": .string("synthetic")]
            )
        )

        XCTAssertEqual(result.revisionNumber, 2)
    }

    private func makeClient() -> TrustCoreClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return TrustCoreClient(
            configuration: .init(
                baseURL: URL(string: "https://trust.invalid")!,
                accessToken: "access-token",
                workspaceID: "workspace-1"
            ),
            session: URLSession(configuration: configuration)
        )
    }

    private static func response(_ request: URLRequest, json: String) -> (HTTPURLResponse, Data) {
        (
            HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!,
            Data(json.utf8)
        )
    }
}

private final class URLProtocolStub: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let (response, data) = try XCTUnwrap(Self.handler)(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

import XCTest
@testable import CompanionCore

final class BrowserLiveDecoderTests: XCTestCase {
    func testDecodesAFrameWithItsDeviceSize() {
        let json = #"{"type":"frame","seq":7,"data":"/9j/abc","format":"jpeg","metadata":{"deviceWidth":1280,"deviceHeight":720}}"#

        guard case let .frame(frame)? = BrowserLiveDecoder.message(from: json) else {
            return XCTFail("expected a frame")
        }
        XCTAssertEqual(frame.seq, 7)
        XCTAssertEqual(frame.data, "/9j/abc")
        XCTAssertEqual(frame.format, "jpeg")
        XCTAssertEqual(frame.deviceWidth, 1280)
        XCTAssertEqual(frame.deviceHeight, 720)
    }

    /// The viewport is what the sink denormalises against, so a status that
    /// loses it would put every click in the wrong place.
    func testDecodesStatusWithTheViewport() {
        let json = #"{"type":"status","connected":true,"screencasting":true,"viewportWidth":1512,"viewportHeight":982}"#

        guard case let .status(status)? = BrowserLiveDecoder.message(from: json) else {
            return XCTFail("expected a status")
        }
        XCTAssertTrue(status.connected)
        XCTAssertTrue(status.screencasting)
        XCTAssertEqual(status.viewportWidth, 1512)
        XCTAssertEqual(status.viewportHeight, 982)
    }

    func testDecodesUrlTabsAndViewerId() {
        guard case let .url(url)? = BrowserLiveDecoder.message(from: #"{"type":"url","url":"https://example.test/"}"#) else {
            return XCTFail("expected a url")
        }
        XCTAssertEqual(url, "https://example.test/")

        let tabsJSON = #"{"type":"tabs","tabs":[{"tabId":"t1","title":"One","url":"https://a.test/","active":true},{"tabId":"t2","title":"","url":"","active":false}]}"#
        guard case let .tabs(tabs)? = BrowserLiveDecoder.message(from: tabsJSON) else {
            return XCTFail("expected tabs")
        }
        XCTAssertEqual(tabs.map(\.tabId), ["t1", "t2"])
        XCTAssertTrue(tabs[0].active)

        guard case let .viewer(id)? = BrowserLiveDecoder.message(from: #"{"type":"viewer","viewerId":"v-1"}"#) else {
            return XCTFail("expected a viewer id")
        }
        XCTAssertEqual(id, "v-1")
    }

    func testDecodesAnErrorWithAFallbackMessage() {
        guard case let .error(message)? = BrowserLiveDecoder.message(from: #"{"type":"error"}"#) else {
            return XCTFail("expected an error")
        }
        XCTAssertFalse(message.isEmpty)
    }

    /// A type we have never seen is a protocol change, not a reason to tear
    /// down a stream the person is watching.
    func testAnUnknownTypeIsDroppedRatherThanFatal() {
        XCTAssertNil(BrowserLiveDecoder.message(from: #"{"type":"something-new","x":1}"#))
    }

    func testMalformedInputIsRejectedWithoutThrowing() {
        XCTAssertNil(BrowserLiveDecoder.message(from: "not json"))
        XCTAssertNil(BrowserLiveDecoder.message(from: "{}"))
        // A frame without its metadata cannot be mapped to coordinates, so it
        // is no use to anyone.
        XCTAssertNil(BrowserLiveDecoder.message(from: #"{"type":"frame","seq":1,"data":"x"}"#))
    }

    func testFrameBytesDecodeFromBase64() {
        let json = #"{"type":"frame","seq":1,"data":"aGVsbG8=","metadata":{"deviceWidth":10,"deviceHeight":10}}"#

        guard case let .frame(frame)? = BrowserLiveDecoder.message(from: json) else {
            return XCTFail("expected a frame")
        }
        XCTAssertEqual(frame.bytes.flatMap { String(data: $0, encoding: .utf8) }, "hello")
    }
}

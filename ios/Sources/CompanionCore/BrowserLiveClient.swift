import Foundation

/// What arrives on `GET /api/bots/:id/browser/live`.
///
/// The server normalises every message before it reaches us
/// (`normalizeBrowserLiveMessage`), so these are the only shapes possible and
/// an unknown one is a protocol change, not untrusted input.
public enum BrowserLiveMessage: Sendable, Equatable {
    case frame(BrowserFrame)
    case status(BrowserStatus)
    case url(String)
    case tabs([BrowserTab])
    case viewer(id: String)
    case error(String)
}

public struct BrowserFrame: Sendable, Equatable {
    public let seq: Int
    /// Base64 JPEG or PNG, exactly as the server framed it.
    public let data: String
    public let format: String
    public let deviceWidth: Double
    public let deviceHeight: Double

    public init(seq: Int, data: String, format: String, deviceWidth: Double, deviceHeight: Double) {
        self.seq = seq
        self.data = data
        self.format = format
        self.deviceWidth = deviceWidth
        self.deviceHeight = deviceHeight
    }

    /// Decoded bytes, or nil when the base64 was not what it claimed to be.
    /// Returning nil rather than throwing keeps the caller a view.
    public var bytes: Data? { Data(base64Encoded: data) }
}

public struct BrowserStatus: Sendable, Equatable {
    public let connected: Bool
    public let screencasting: Bool
    public let viewportWidth: Double
    public let viewportHeight: Double

    public init(connected: Bool, screencasting: Bool, viewportWidth: Double, viewportHeight: Double) {
        self.connected = connected
        self.screencasting = screencasting
        self.viewportWidth = viewportWidth
        self.viewportHeight = viewportHeight
    }
}

public struct BrowserTab: Sendable, Equatable, Identifiable {
    public let tabId: String
    public let title: String
    public let url: String
    public let active: Bool

    public init(tabId: String, title: String, url: String, active: Bool) {
        self.tabId = tabId
        self.title = title
        self.url = url
        self.active = active
    }

    public var id: String { tabId }
}

/// Decodes one server message.
///
/// Written by hand because the wire is a tagged union keyed on `type`, and
/// because a message we do not understand must be dropped rather than crash a
/// stream the person is watching.
public enum BrowserLiveDecoder {
    public static func message(from json: String) -> BrowserLiveMessage? {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return nil }

        switch type {
        case "frame":
            guard let seq = object["seq"] as? Int,
                  let payload = object["data"] as? String,
                  let metadata = object["metadata"] as? [String: Any],
                  let width = metadata["deviceWidth"] as? Double ?? (metadata["deviceWidth"] as? Int).map(Double.init),
                  let height = metadata["deviceHeight"] as? Double ?? (metadata["deviceHeight"] as? Int).map(Double.init)
            else { return nil }
            return .frame(BrowserFrame(
                seq: seq,
                data: payload,
                format: (object["format"] as? String) ?? "jpeg",
                deviceWidth: width,
                deviceHeight: height
            ))

        case "status":
            guard let connected = object["connected"] as? Bool else { return nil }
            let width = (object["viewportWidth"] as? Double) ?? Double((object["viewportWidth"] as? Int) ?? 1280)
            let height = (object["viewportHeight"] as? Double) ?? Double((object["viewportHeight"] as? Int) ?? 720)
            return .status(BrowserStatus(
                connected: connected,
                screencasting: (object["screencasting"] as? Bool) ?? false,
                viewportWidth: width,
                viewportHeight: height
            ))

        case "url":
            guard let url = object["url"] as? String else { return nil }
            return .url(url)

        case "tabs":
            guard let raw = object["tabs"] as? [[String: Any]] else { return nil }
            return .tabs(raw.compactMap { tab in
                guard let id = tab["tabId"] as? String else { return nil }
                return BrowserTab(
                    tabId: id,
                    title: (tab["title"] as? String) ?? "",
                    url: (tab["url"] as? String) ?? "",
                    active: (tab["active"] as? Bool) ?? false
                )
            })

        case "viewer":
            guard let id = object["viewerId"] as? String else { return nil }
            return .viewer(id: id)

        case "error":
            return .error((object["message"] as? String) ?? "The browser stream was interrupted.")

        default:
            // A type we do not know is a protocol change, not a reason to
            // tear down a stream the person is watching.
            return nil
        }
    }
}

/// The browser-live transport: one SSE stream in, one action channel out.
public struct BrowserLiveClient: Sendable {
    private let connection: Connection
    private let token: String?
    private let session: URLSession

    public init(connection: Connection, token: String?, session: URLSession = .shared) {
        self.connection = connection
        self.token = token
        self.session = session
    }

    private func request(_ method: String, _ path: String, body: Data? = nil) throws -> URLRequest {
        guard let base = connection.baseURL,
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else { throw APIError.badURL }
        components.path = path
        guard let url = components.url else { throw APIError.badURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        return request
    }

    /// The frame stream. Runs until the server ends it or the consuming task
    /// is cancelled; reconnection belongs to whatever knows if the view is
    /// still on screen, exactly as it does for the main event stream.
    public func live(botId: String) -> AsyncThrowingStream<BrowserLiveMessage, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = try request("GET", "/api/bots/\(botId)/browser/live")
                    // A frame stream has no business timing out: it is idle
                    // whenever the page is.
                    request.timeoutInterval = .infinity
                    let (bytes, response) = try await session.bytes(for: request)
                    if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                        throw APIError.status(code: http.statusCode, message: nil)
                    }

                    var parser = SSEParser()
                    var line = [UInt8]()
                    // A byte at a time, and deliberately not `bytes.lines`:
                    // that folds consecutive newlines together, and a blank
                    // line is exactly what ends an SSE event. See SSE.swift.
                    for try await byte in bytes {
                        if byte == UInt8(ascii: "\n") {
                            let text = String(decoding: line, as: UTF8.self)
                            line.removeAll(keepingCapacity: true)
                            if let event = parser.line(text),
                               let message = BrowserLiveDecoder.message(from: event.data) {
                                continuation.yield(message)
                            }
                        } else {
                            line.append(byte)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// One action. The server answers only after the browser has applied it,
    /// which is what makes the queue's one-in-flight rule necessary.
    @discardableResult
    public func action(botId: String, viewerId: String, body: [String: Any]) async throws -> [String: Any] {
        var payload = body
        payload["viewerId"] = viewerId
        let encoded = try JSONSerialization.data(withJSONObject: payload)
        let request = try request("POST", "/api/bots/\(botId)/browser/action", body: encoded)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badURL }
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard http.statusCode == 200 else {
            throw APIError.status(code: http.statusCode, message: object?["error"] as? String)
        }
        return object ?? [:]
    }

    /// An input body, posted through the same channel.
    public func send(botId: String, viewerId: String, input: BrowserInputBody) async throws {
        let encoded = try JSONEncoder().encode(input)
        guard var object = (try? JSONSerialization.jsonObject(with: encoded)) as? [String: Any] else {
            throw APIError.badURL
        }
        object["viewerId"] = viewerId
        _ = try await action(botId: botId, viewerId: viewerId, body: object)
    }
}

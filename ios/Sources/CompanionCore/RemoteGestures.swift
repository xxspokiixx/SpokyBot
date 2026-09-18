import Foundation

/// Contract values shared with android/core's `GestureConstants`. A value that
/// differs between the two platforms is a bug the parity fixture must catch,
/// so they are stated once here and once there rather than derived from
/// anything — a derivation is a place the two can quietly disagree.
public enum GestureConstants {
    /// Longest gap that still extends a click sequence.
    public static let multiClickWindow = 0.450
    /// Furthest a finger may land from the last tap and still count as a
    /// double click rather than two clicks on two different targets.
    public static let multiClickSlop = 0.02
    /// Hold before a long press fires.
    public static let longPress = 0.500
    /// Movement that cancels a pending long press.
    public static let longPressSlop = 0.015
    /// Movement before a touch is a drag rather than a tap.
    public static let dragThreshold = 0.01
    /// A sequence wraps rather than growing without bound.
    public static let maxClicks = 3
    public static let minZoom = 1.0
    public static let maxZoom = 6.0
    /// Per-frame velocity decay at 60fps, and the speed below which a flick
    /// has visibly stopped and should send nothing further.
    public static let momentumDecay = 0.94
    public static let momentumCutoff = 0.0004
}

public enum TouchPhase: String, Sendable, Codable {
    case began, moved, ended, cancelled
}

/// One finger at one instant, in the view's own point space.
///
/// The core does every conversion itself, so an adapter never needs to know
/// the frame's size, the letterbox insets or the zoom. That is what keeps the
/// platform layers free of arithmetic worth testing.
public struct TouchSample: Sendable, Equatable, Codable {
    public let id: Int
    public let phase: TouchPhase
    public let x: Double
    public let y: Double
    /// Seconds from any fixed origin. The core has no clock of its own, so
    /// this is the only time it ever sees.
    public let t: Double

    public init(id: Int, phase: TouchPhase, x: Double, y: Double, t: Double) {
        self.id = id
        self.phase = phase
        self.x = x
        self.y = y
        self.t = t
    }
}

public enum RemoteButton: String, Sendable, Equatable, Codable {
    case left, right, middle
}

/// What the remote should be told.
///
/// Zoom and pan are deliberately absent. They are local view state, and
/// sending them would reflow the remote page under the person instead of
/// magnifying their own copy of it.
public enum GestureIntent: Sendable, Equatable {
    case move(x: Double, y: Double)
    case press(button: RemoteButton, clicks: Int)
    case release(button: RemoteButton)
    case scroll(dx: Double, dy: Double)
    case text(String)
    case key(name: String, modifiers: Int)
}

public enum GestureMode: String, Sendable, Codable {
    case direct, trackpad
}

/// Local magnification. `offset` is the top-left of the visible window in
/// normalised frame units, so identity shows the whole frame.
public struct ViewTransform: Sendable, Equatable, Codable {
    public var scale: Double
    public var offsetX: Double
    public var offsetY: Double

    public static let identity = ViewTransform(scale: 1, offsetX: 0, offsetY: 0)

    public init(scale: Double, offsetX: Double, offsetY: Double) {
        self.scale = scale
        self.offsetX = offsetX
        self.offsetY = offsetY
    }
}

/// A point on the remote surface, normalised to 0...1.
public struct RemotePoint: Sendable, Equatable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// The only thing in the system that thinks in pixels.
///
/// It folds three transforms into one: aspect-fit letterboxing, local zoom
/// and local pan. Keeping them together means there is a single place where a
/// coordinate can be got wrong, and a single place to test.
public struct ViewportMapping: Sendable, Equatable {
    public let viewWidth: Double
    public let viewHeight: Double
    public let frameWidth: Double
    public let frameHeight: Double
    public let transform: ViewTransform

    public init(
        viewWidth: Double,
        viewHeight: Double,
        frameWidth: Double,
        frameHeight: Double,
        transform: ViewTransform
    ) {
        self.viewWidth = viewWidth
        self.viewHeight = viewHeight
        self.frameWidth = frameWidth
        self.frameHeight = frameHeight
        self.transform = transform
    }

    /// Normalised frame coordinates for a view point, or nil when the point
    /// is outside the drawn image and no drag has captured the pointer.
    ///
    /// `captured` is the difference between a stray tap on the letterbox,
    /// which means nothing and is refused, and a selection drag that wandered
    /// off the image, which must keep tracking at the edge.
    public func remotePoint(viewX: Double, viewY: Double, captured: Bool) -> RemotePoint? {
        let sizes = [viewWidth, viewHeight, frameWidth, frameHeight]
        guard sizes.allSatisfy({ $0.isFinite && $0 > 0 }),
              viewX.isFinite, viewY.isFinite,
              transform.scale.isFinite, transform.scale > 0 else { return nil }

        let fit = min(viewWidth / frameWidth, viewHeight / frameHeight)
        let drawnWidth = frameWidth * fit
        let drawnHeight = frameHeight * fit
        let localX = (viewX - (viewWidth - drawnWidth) / 2) / drawnWidth
        let localY = (viewY - (viewHeight - drawnHeight) / 2) / drawnHeight
        if !captured, localX < 0 || localY < 0 || localX > 1 || localY > 1 { return nil }

        return RemotePoint(
            x: min(max(transform.offsetX + localX / transform.scale, 0), 1),
            y: min(max(transform.offsetY + localY / transform.scale, 0), 1)
        )
    }
}

import CoreGraphics
import XCTest

@testable import CompanionCore

/// The avatar's three-way decision and the image fit that feeds it.
///
/// `BotAvatarView` is a `Canvas` and a `.task`, neither of which a unit test
/// can assert on — so the decision it makes lives here instead, the way the
/// desktop's `resolveBotAvatarOutcome` does (`src/components/Avatar.test.ts`).
/// The rule under test is the spec's: a missing, stale or undecodable
/// attachment falls back to the gradient mascot, never to an empty or
/// half-drawn body.
final class BotAvatarRenderingTests: XCTestCase {
    private func outcome(
        _ crop: AvatarCrop, hasUrl: Bool = true, decoded: Bool = true, failed: Bool = false
    ) -> BotAvatarOutcome {
        resolveBotAvatarOutcome(
            crop: crop, hasUrl: hasUrl, imageDecoded: decoded, failed: failed)
    }

    func testMascotAlwaysDrawsTheGradientBody() {
        XCTAssertEqual(outcome(.mascot), .gradientMascot)
        XCTAssertEqual(outcome(.mascot, hasUrl: false), .gradientMascot)
    }

    func testFlatCropsWearTheImageItself() {
        for crop in [AvatarCrop.circle, .rounded, .square] {
            XCTAssertEqual(outcome(crop), .flatImage, "\(crop) should crop the image")
        }
    }

    func testFaceWearsTheImageAsABody() {
        XCTAssertEqual(outcome(.face), .livingMascot)
    }

    /// The whole point of the fallback: every crop with no usable picture
    /// lands on the gradient mascot, whether the attachment is absent, still
    /// in flight, or came back undecodable.
    func testEveryCropFallsBackToTheGradientMascotWithoutAPicture() {
        for crop in AvatarCrop.allCases {
            XCTAssertEqual(outcome(crop, hasUrl: false), .gradientMascot, "\(crop) with no url")
            XCTAssertEqual(outcome(crop, decoded: false), .gradientMascot, "\(crop) still loading")
            XCTAssertEqual(
                outcome(crop, decoded: false, failed: true), .gradientMascot, "\(crop) failed")
        }
    }

    /// A decode that succeeded and then a failure flag: still the mascot.
    /// `failed` is the explicit signal and must win on its own.
    func testAFailedFetchNeverDrawsTheImage() {
        XCTAssertEqual(outcome(.face, failed: true), .gradientMascot)
        XCTAssertEqual(outcome(.circle, failed: true), .gradientMascot)
    }

    // MARK: - The image fit

    private let box = CGRect(x: 10, y: 20, width: 100, height: 100)

    func testSliceCoversTheTargetAndKeepsTheAspectRatio() {
        // Wide picture: height matches, width overflows both sides evenly.
        let wide = MausImageFit.slice(CGSize(width: 400, height: 200), in: box)
        XCTAssertEqual(wide.height, 100, accuracy: 0.001)
        XCTAssertEqual(wide.width, 200, accuracy: 0.001)
        XCTAssertEqual(wide.midX, box.midX, accuracy: 0.001)
        XCTAssertEqual(wide.midY, box.midY, accuracy: 0.001)
        XCTAssertLessThanOrEqual(wide.minX, box.minX)
        XCTAssertGreaterThanOrEqual(wide.maxX, box.maxX)

        // Tall picture: the other axis overflows instead.
        let tall = MausImageFit.slice(CGSize(width: 200, height: 400), in: box)
        XCTAssertEqual(tall.width, 100, accuracy: 0.001)
        XCTAssertEqual(tall.height, 200, accuracy: 0.001)
        XCTAssertLessThanOrEqual(tall.minY, box.minY)
        XCTAssertGreaterThanOrEqual(tall.maxY, box.maxY)

        // Never letterboxed: the target is covered in both directions.
        for size in [CGSize(width: 3, height: 800), CGSize(width: 900, height: 4)] {
            let rect = MausImageFit.slice(size, in: box)
            XCTAssertTrue(rect.contains(box), "\(size) left part of the body uncovered")
            XCTAssertEqual(
                rect.width / rect.height, size.width / size.height, accuracy: 0.001,
                "\(size) was squashed")
        }
    }

    func testSliceOfASquareIntoASquareIsTheSquare() {
        let rect = MausImageFit.slice(CGSize(width: 512, height: 512), in: box)
        XCTAssertEqual(rect, box)
    }

    /// A zero-pixel decode must not produce a NaN rect for the canvas.
    func testDegenerateSizesFallBackToTheTarget() {
        XCTAssertEqual(MausImageFit.slice(.zero, in: box), box)
        XCTAssertEqual(MausImageFit.slice(CGSize(width: 10, height: 0), in: box), box)
        XCTAssertEqual(MausImageFit.slice(CGSize(width: 10, height: 10), in: .zero), .zero)
    }

    /// The fit is handed the whole face box, exactly as the desktop's
    /// `<image>` is — so the slice must cover every shipped body, whatever
    /// the picture's shape, with the clip doing the shaping.
    func testEveryShippedBodyIsFullyCoveredByAnImageSlicedIntoTheFaceBox() {
        let faceBox = CGRect(
            x: 0, y: 0, width: MausSilhouette.faceBox, height: MausSilhouette.faceBox)
        for size in [
            CGSize(width: 1024, height: 1024), CGSize(width: 1920, height: 1080),
            CGSize(width: 640, height: 1136), CGSize(width: 3, height: 800),
        ] {
            let rect = MausImageFit.slice(size, in: faceBox)
            for id in MausBodies.order {
                // The bodies are asserted to sit inside the face box (±1) by
                // `MausBodiesTests`; the same tolerance applies here.
                XCTAssertTrue(
                    rect.insetBy(dx: -1.5, dy: -1.5).contains(MausSilhouette.faceBoxBounds(id)),
                    "\(id) is not covered by a \(size) picture")
            }
        }
    }

    // MARK: - The crop an uploaded picture lands on

    /// The phone and the desktop must agree on what uploading a picture
    /// means, or the same action produces two different bots. Generation is
    /// deliberately *not* this rule — see `afterGenerating` below.
    func testUploadingAPicturePromotesTheMascotToLiving() {
        XCTAssertEqual(AvatarCrop.mascot.afterUploadingAPicture, .face)
    }

    func testUploadingAPictureKeepsAnExplicitChoice() {
        for crop in [AvatarCrop.face, .circle, .rounded, .square] {
            XCTAssertEqual(crop.afterUploadingAPicture, crop, "\(crop) was overwritten")
        }
    }

    // MARK: - The crop a generated picture lands on

    /// This is the regression that has happened twice: a mascot bot that
    /// generates a new avatar must take the server's `circle`, not the
    /// `face` promotion that uploading gets. A generated image is its own
    /// portrait, already wearing a face the model painted — not the mascot's
    /// living body — so it must never be treated like an upload.
    func testGeneratingFromAMascotBotTakesTheServersCircleNotFacePromotion() {
        XCTAssertEqual(
            AvatarCrop.afterGenerating(cropAtStart: .mascot, latestCrop: .mascot, serverCrop: .circle),
            .circle)
    }

    /// If the user moves the picker while the request is still in flight,
    /// that newer explicit choice wins outright — the server's pick, whatever
    /// it was, is discarded.
    func testMovingThePickerMidFlightWinsOverTheServersPick() {
        XCTAssertEqual(
            AvatarCrop.afterGenerating(cropAtStart: .mascot, latestCrop: .face, serverCrop: .circle),
            .face)
        XCTAssertEqual(
            AvatarCrop.afterGenerating(cropAtStart: .circle, latestCrop: .rounded, serverCrop: .square),
            .rounded)
    }

    /// No server crop at all falls back to `.mascot` — the same "no picture"
    /// state a missing crop means everywhere else, never a promotion to
    /// `.face`.
    func testNoServerCropFallsBackToMascot() {
        XCTAssertEqual(
            AvatarCrop.afterGenerating(cropAtStart: .mascot, latestCrop: .mascot, serverCrop: nil),
            .mascot)
    }
}

// How a bot's avatar resolves: which of the three renderings it gets, and —
// once an image is wearing the mascot's body — how that image covers it.
//
// Both halves are pure geometry/logic with no view in them, which is the
// point: `swift test` builds `Sources/CompanionCore` and nothing else, so a
// decision left inside `BotAvatarView`'s `body` is a decision no test can
// reach. The desktop split the same decision out for the same reason —
// `resolveBotAvatarOutcome` in `src/components/Avatar.tsx`, tested in
// `src/components/Avatar.test.ts`.
import CoreGraphics
import Foundation

/// The three ways a bot's identity can be drawn.
///
/// Mirrors the desktop's `BotAvatarOutcome` union, name for name, so the two
/// renderers can be compared by reading them side by side.
public enum BotAvatarOutcome: String, CaseIterable, Hashable, Sendable {
    /// The uploaded picture itself, masked to a circle/rounded/square. No
    /// mascot: the image replaces it.
    case flatImage
    /// The mascot, wearing the picture as its body, with the live face
    /// painted on top.
    case livingMascot
    /// The mascot in the bot's own colour gradient. Also the fallback for
    /// everything that cannot be drawn.
    case gradientMascot
}

/// Pick how to draw a bot's avatar from the profile plus what has actually
/// been confirmed to load.
///
/// The fallback is the spec's, not a convenience: a missing, stale or
/// undecodable attachment lands on `.gradientMascot`, so identity is never an
/// empty placeholder or a half-drawn body. On the phone the confirmation is
/// the decode itself — `imageDecoded` is true only once `UIImage(data:)`
/// returned something — which is the same guarantee the desktop buys with an
/// off-screen `Image()` probe before it ever wears the picture as a body.
///
/// `failed` is a fetch or decode that already came back empty; `imageDecoded
/// == false` on its own also covers "still in flight". Both draw the gradient
/// mascot, and deliberately so: an avatar that is still loading shows the
/// bot's colours rather than a hole, exactly as it did before `face` existed.
public func resolveBotAvatarOutcome(
    crop: AvatarCrop,
    hasUrl: Bool,
    imageDecoded: Bool,
    failed: Bool
) -> BotAvatarOutcome {
    // No attachment at all, or the bot asked for the plain mascot.
    guard hasUrl, crop != .mascot else { return .gradientMascot }
    // Nothing to draw with yet — in flight, or gone.
    guard imageDecoded, !failed else { return .gradientMascot }
    return crop == .face ? .livingMascot : .flatImage
}

extension AvatarCrop {
    /// The crop to persist when the user *uploads* a picture while this one
    /// is selected.
    ///
    /// `mascot` means "no picture", so uploading one promotes it to `face` —
    /// the mascot still alive, now wearing the picture. That is what the
    /// desktop's upload handler does (`latestCrop === "mascot" ? "face" :
    /// latestCrop` in `src/components/BotProfileAvatarCard.tsx`), so the same
    /// upload has to make the same bot on either screen. Any explicit choice
    /// is kept exactly as made.
    ///
    /// Uploads only, hence the name: a *generated* avatar takes the crop the
    /// server assigns it (`server/index.ts`, which picks `circle` for a
    /// mascot bot), because `avatarGenerationPrompt` asks for a centred
    /// square character portrait — art that already has a face, and that the
    /// mascot's eyes and mouth should not be painted over. Reaching for this
    /// property on the generate path would reintroduce that divergence.
    public var afterUploadingAPicture: AvatarCrop { self == .mascot ? .face : self }

    /// The crop to persist once a *generated* avatar comes back.
    ///
    /// Unlike `afterUploadingAPicture`, this never promotes `.mascot` to
    /// `.face`: a generated image is a portrait the model painted on its own
    /// prompt, not the mascot's living body, so it keeps whatever crop the
    /// server chose (`serverCrop`, from `server/index.ts` — `circle` for a
    /// mascot bot, per `avatarGenerationPrompt` in `server/avatar-image.ts`
    /// asking for a centred subject that already has its own face). A `nil`
    /// `serverCrop` is unreachable in practice — the server always assigns a
    /// crop — so the fallback matches the desktop's
    /// (`result.bot.avatarCrop ?? "circle"` in
    /// `src/components/BotProfileAvatarCard.tsx`): `.circle`, what the server
    /// actually assigns a mascot bot, not the `.mascot` "no picture" state.
    ///
    /// The one thing that overrides the server is the user themselves: if
    /// they move the crop picker while generation was still in flight,
    /// `latestCrop` differs from `cropAtStart` and that newer explicit choice
    /// wins outright, server pick or not.
    public static func afterGenerating(
        cropAtStart: AvatarCrop,
        latestCrop: AvatarCrop,
        serverCrop: AvatarCrop?
    ) -> AvatarCrop {
        latestCrop != cropAtStart ? latestCrop : (serverCrop ?? .circle)
    }
}

/// Where to draw an image so it covers a rect with its aspect ratio intact.
public enum MausImageFit {
    /// The destination rect for an image of `image` size that covers `target`
    /// completely, centred, with nothing squashed — SVG's
    /// `preserveAspectRatio="xMidYMid slice"` and CSS's `object-fit: cover`.
    ///
    /// The returned rect has the image's own aspect ratio, which is what makes
    /// this safe to hand to `GraphicsContext.draw(_:in:)`: whether that scales
    /// to fit or stretches to fill, an aspect-matched destination gives the
    /// same picture either way. The overflow is clipped by the silhouette.
    ///
    /// A degenerate size (a zero-pixel decode, an empty body) returns `target`
    /// rather than a NaN rect.
    public static func slice(_ image: CGSize, in target: CGRect) -> CGRect {
        guard image.width > 0, image.height > 0, target.width > 0, target.height > 0
        else { return target }
        let scale = max(target.width / image.width, target.height / image.height)
        let size = CGSize(width: image.width * scale, height: image.height * scale)
        return CGRect(
            x: target.midX - size.width / 2,
            y: target.midY - size.height / 2,
            width: size.width,
            height: size.height
        )
    }
}

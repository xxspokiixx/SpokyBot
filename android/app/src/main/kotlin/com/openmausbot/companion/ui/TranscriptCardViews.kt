package com.openmausbot.companion.ui

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.Reasoning
import com.openmausbot.companion.core.TranscriptCard
import java.util.Locale
import kotlinx.coroutines.launch

/**
 * The three affordances a transcript grows when the reply is more than prose —
 * the port of `ios/App/Cards/GitPRDiffCardView.swift`,
 * `ios/App/Cards/SQLResultTableView.swift` and
 * `ios/App/Cards/AgentThoughtChamberView.swift`.
 *
 * Whether a reply *is* one of these is `TranscriptCards` in `:core`, and it is
 * strict on purpose: a card that swallowed a paragraph would hide the answer
 * inside it. This file is only the drawing, and it is Material drawing. The iOS
 * cards are gradients over `.ultraThinMaterial` with Tailwind hexes; the same
 * information here is a tonal surface, the app's own palette for the two colours
 * a diff actually means (added, removed), and Material's divider and text
 * button. What is not free, and is kept exactly: the whole patch on the
 * clipboard, RFC 4180 quoting, the 80-line preview, and a chamber that starts
 * closed.
 */

/** What the clipboard shows a copied card came from. */
private const val CARD_CLIP_LABEL = "OpenMausMobile card"

/** Added and removed, in the app's own palette rather than Tailwind's. */
private val DiffAdded = Color(MausPalette.argb("green"))
private val DiffRemoved = Color(MausPalette.argb("red"))
private val DiffHunk = Color(MausPalette.argb("cyan"))

/**
 * A patch, with its head visible and all of it on the clipboard.
 *
 * The preview stops at 80 lines because a 4,000-line patch inside a scrolling
 * transcript is a scroll the reader cannot get out of. Copy Diff never stops:
 * the clipboard is where the patch is actually used.
 */
@Composable
fun DiffCard(card: TranscriptCard.Diff, modifier: Modifier = Modifier) {
    var showingDiff by rememberSaveable(card.text) { mutableStateOf(true) }
    var showingAll by rememberSaveable(card.text) { mutableStateOf(false) }
    val copy = rememberCopy()

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = card.filename,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            Row(
                modifier = Modifier
                    .background(secondaryTint.copy(alpha = 0.14f), CircleShape)
                    .padding(horizontal = 8.dp, vertical = 3.dp)
                    // Two glyphs and two numbers say "three added, one removed"
                    // to anyone who can see them; this says it to everyone else.
                    .semantics(mergeDescendants = true) {
                        contentDescription =
                            "${card.additions} lines added, ${card.deletions} removed"
                    },
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = "+${card.additions}",
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    color = DiffAdded,
                )
                Text(
                    text = "-${card.deletions}",
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    color = DiffRemoved,
                )
            }
        }

        if (card.text.isNotEmpty()) {
            Disclosure(
                expanded = showingDiff,
                label = if (showingDiff) "Hide Diff" else "View Diff",
                onToggle = { showingDiff = !showingDiff },
            )

            if (showingDiff) {
                val lines = remember(card, showingAll) { card.visibleLines(showingAll) }
                // Horizontal scroll rather than wrapping, for the same reason the
                // markdown code block does it: indentation is most of what a
                // patch is saying, and a wrapped `-` line stops looking removed.
                SelectionContainer {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                secondaryTint.copy(alpha = 0.10f),
                                RoundedCornerShape(10.dp),
                            )
                            .horizontalScroll(rememberScrollState())
                            .padding(8.dp),
                        verticalArrangement = Arrangement.spacedBy(1.dp),
                    ) {
                        lines.forEach { DiffLine(it) }
                    }
                }

                if (card.isTruncated) {
                    val label = if (showingAll) {
                        "Show first ${TranscriptCard.Diff.PREVIEW_LINES} lines"
                    } else {
                        "Show all ${card.lines.size} lines"
                    }
                    TextButton(
                        onClick = { showingAll = !showingAll },
                        // Compose has no "hint" the way UIAccessibility does, so
                        // iOS's hint is folded into the name: the reader must not
                        // be left thinking Copy Diff copies the preview.
                        modifier = Modifier.semantics {
                            contentDescription =
                                "$label. The copied diff always includes every line"
                        },
                    ) {
                        Text(label, fontSize = 13.sp)
                    }
                }
            }
        }

        HorizontalDivider(color = secondaryTint.copy(alpha = 0.2f))

        TextButton(onClick = { copy(card.text) }) {
            Text("Copy Diff", fontSize = 13.sp)
        }
    }
}

@Composable
private fun DiffLine(line: String) {
    val added = line.startsWith("+") && !line.startsWith("+++")
    val removed = line.startsWith("-") && !line.startsWith("---")
    val hunk = line.startsWith("@@") || line.startsWith("diff")
    Text(
        text = line,
        fontSize = 12.sp,
        fontFamily = FontFamily.Monospace,
        softWrap = false,
        color = when {
            added -> DiffAdded
            removed -> DiffRemoved
            hunk -> DiffHunk
            else -> MaterialTheme.colorScheme.onSurface
        },
        modifier = Modifier
            .background(
                when {
                    added -> DiffAdded.copy(alpha = 0.14f)
                    removed -> DiffRemoved.copy(alpha = 0.14f)
                    else -> Color.Transparent
                },
                RoundedCornerShape(3.dp),
            )
            .padding(horizontal = 4.dp, vertical = 1.dp),
    )
}

/**
 * A table the reader can actually read across, and take away as CSV.
 *
 * Laid out column by column rather than row by row: a column that measures
 * itself is a column whose cells line up, which is the whole reason to draw a
 * table instead of the pipes it arrived as. iOS gives every cell the same
 * `minWidth` and lets them drift apart; that is the one place this deliberately
 * does better rather than the same.
 */
@Composable
fun DataTableCard(card: TranscriptCard.Table, modifier: Modifier = Modifier) {
    val copy = rememberCopy()
    val scroll = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "DATA TABLE",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = if (card.rows.size == 1) "1 row" else "${card.rows.size} rows",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = secondaryTint,
                modifier = Modifier
                    .background(secondaryTint.copy(alpha = 0.14f), CircleShape)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }

        SelectionContainer {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(scroll),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                card.headers.forEachIndexed { index, header ->
                    Column(
                        // Intrinsic width is what makes the rule under a heading
                        // as wide as the column it belongs to: inside a scroll the
                        // incoming width is unbounded, and `fillMaxWidth` against
                        // an unbounded constraint measures zero.
                        modifier = Modifier
                            .widthIn(min = 64.dp)
                            .width(IntrinsicSize.Max),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            // Uppercased by the invariant rules, like every other
                            // section label in this app: a reader in `tr-TR` must
                            // still read the column name, not a dotted capital.
                            text = header.uppercase(Locale.ROOT),
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                            softWrap = false,
                        )
                        HorizontalDivider(color = secondaryTint.copy(alpha = 0.25f))
                        card.rows.forEach { row ->
                            Text(
                                text = row.getOrElse(index) { "" },
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace,
                                softWrap = false,
                            )
                        }
                    }
                }
            }
        }

        HorizontalDivider(color = secondaryTint.copy(alpha = 0.2f))

        TextButton(onClick = { copy(card.csv()) }) {
            Text("Copy CSV", fontSize = 13.sp)
        }
    }
}

/**
 * The bot thinking out loud, folded away until it is asked for.
 *
 * Closed by default: reasoning is not the answer, and a wall of it above an
 * empty bubble reads as the reply itself. Open, it is the last
 * [Reasoning.VISIBLE_CHARACTERS] characters as numbered lines in their own
 * scroller — 2,000 rather than the 400 this used to show, which was a quarter of
 * the thought with no way to reach the rest.
 */
@Composable
fun ThoughtChamber(
    reasoning: String,
    modifier: Modifier = Modifier,
    streaming: Boolean = true,
) {
    val steps = remember(reasoning) { Reasoning.steps(reasoning) }
    var expanded by rememberSaveable { mutableStateOf(false) }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET)
                .background(secondaryTint.copy(alpha = 0.12f), CircleShape)
                .clickable(
                    role = Role.Button,
                    onClickLabel = if (expanded) "Collapse" else "Expand",
                    onClick = { expanded = !expanded },
                )
                .semantics {
                    stateDescription = if (expanded) "Expanded" else "Collapsed"
                }
                .padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_sparkles),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(16.dp),
            )
            Text(
                text = if (streaming) "Thinking…" else "Thought Process",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = if (steps.size == 1) "1 step" else "${steps.size} steps",
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                color = secondaryTint,
            )
            Icon(
                imageVector = if (expanded) {
                    Icons.Filled.KeyboardArrowUp
                } else {
                    Icons.Filled.KeyboardArrowDown
                },
                contentDescription = null,
                tint = secondaryTint,
                modifier = Modifier.size(18.dp),
            )
        }

        if (expanded) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        secondaryTint.copy(alpha = 0.08f),
                        RoundedCornerShape(12.dp),
                    )
                    .heightIn(max = CHAMBER_HEIGHT)
                    .verticalScroll(rememberScrollState())
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                steps.forEachIndexed { index, step ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text = "${index + 1}.",
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(text = step, fontSize = 13.sp, color = secondaryTint)
                    }
                }
            }
        }
    }
}

/** Hide/View, announced as the disclosure it is. */
@Composable
private fun Disclosure(expanded: Boolean, label: String, onToggle: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = MIN_TOUCH_TARGET)
            .clip(RoundedCornerShape(8.dp))
            .clickable(
                role = Role.Button,
                onClickLabel = if (expanded) "Collapse" else "Expand",
                onClick = onToggle,
            )
            .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (expanded) {
                Icons.Filled.KeyboardArrowDown
            } else {
                Icons.AutoMirrored.Filled.KeyboardArrowRight
            },
            contentDescription = null,
            tint = secondaryTint,
            modifier = Modifier.size(18.dp),
        )
        Text(text = label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = secondaryTint)
    }
}

/** One clipboard write, reused by both cards. */
@Composable
private fun rememberCopy(): (String) -> Unit {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    return remember(clipboard, scope) {
        { text: String ->
            scope.launch {
                clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(CARD_CLIP_LABEL, text)))
            }
            Unit
        }
    }
}

private val CHAMBER_HEIGHT = 180.dp

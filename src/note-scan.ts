// Finds the recordings a note refers to, and what to identify in each:
// every section of a `loops` block (or just the `select:` one), or the whole
// file for an audio embed with no loops block. Pure text processing, so it
// runs under Node for the tests.
import { parseLoopsBlock, type LoopsBlock } from "./loops.ts";

export const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "ogg", "flac", "aac", "webm", "3gp"];

/** A place in the note with audio, and where its results go. */
export interface Anchor {
	/** Link text or `file:` path, as written in the note. */
	link: string;
	/** Line of the `![[...]]` embed, or -1 for a loops block with only a `file:` line. */
	embedLine: number;
	/** First and last line (the fences) of the loops block, if there is one. */
	loops: { startLine: number; endLine: number; block: LoopsBlock } | null;
	/** Results are written on the lines after this one. */
	insertAfterLine: number;
	/** Indentation of the list item the embed sits in, or null if it isn't in a list. */
	listIndent: string | null;
	/** "link#n": the n-th anchor for this link. Used to find it again after edits. */
	key: string;
}

/** One stretch of audio to identify. */
export interface Segment {
	anchorKey: string;
	link: string;
	/** Seconds. */
	start: number;
	/** Seconds, or null for "to the end of the file". */
	end: number | null;
	/** Loop label such as "Tune 2 ?", or "" for a whole file. */
	label: string;
	/** The range as written in the loops block, or "" for a whole file. */
	rangeText: string;
	/** 1-based section number within its loops block, or 0 for a whole file. */
	section: number;
}

const EMBED = /!\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/;

export function isAudioPath(path: string): boolean {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return AUDIO_EXTENSIONS.includes(ext);
}

/** File name without folders, lower-cased, for comparing links loosely. */
function linkName(link: string): string {
	return (link.split("/").pop() ?? link).trim().toLowerCase();
}

export function findAnchors(text: string): Anchor[] {
	const lines = text.split("\n");
	const embeds: { line: number; link: string; listIndent: string | null }[] = [];
	const blocks: { startLine: number; endLine: number; block: LoopsBlock }[] = [];

	// Frontmatter is not note content.
	let i = 0;
	if (lines[0]?.trimEnd() === "---") {
		const close = lines.findIndex((l, n) => n > 0 && l.trimEnd() === "---");
		if (close > 0) i = close + 1;
	}

	for (; i < lines.length; i++) {
		const fence = lines[i].match(FENCE);
		if (fence) {
			const marker = fence[2];
			let end = i + 1;
			while (end < lines.length && !lines[end].trim().startsWith(marker)) end++;
			if (fence[3].toLowerCase() === "loops" && end < lines.length) {
				blocks.push({ startLine: i, endLine: end, block: parseLoopsBlock(lines.slice(i + 1, end).join("\n")) });
			}
			i = end;
			continue;
		}
		for (const m of lines[i].matchAll(EMBED)) {
			const link = m[1].trim();
			if (!isAudioPath(link)) continue;
			const list = lines[i].match(LIST_ITEM);
			embeds.push({ line: i, link, listIndent: list ? list[1] : null });
		}
	}

	// A loops block belongs to its `file:` recording, or else to the closest
	// audio embed above it, as in audio-loop-player.
	const covered = new Set<number>();
	const anchors: Omit<Anchor, "key">[] = [];
	for (const b of blocks) {
		const above = embeds.filter((e) => e.line < b.startLine);
		let embed = above.length ? above[above.length - 1] : undefined;
		if (b.block.file && embed && linkName(embed.link) !== linkName(b.block.file)) embed = undefined;
		const link = b.block.file ?? embed?.link;
		if (!link) continue;
		if (embed) covered.add(embed.line);
		anchors.push({
			link,
			embedLine: embed ? embed.line : -1,
			loops: b,
			insertAfterLine: b.endLine,
			listIndent: null,
		});
	}
	for (const e of embeds) {
		if (covered.has(e.line)) continue;
		anchors.push({ link: e.link, embedLine: e.line, loops: null, insertAfterLine: e.line, listIndent: e.listIndent });
	}

	anchors.sort((a, b) => a.insertAfterLine - b.insertAfterLine);
	const seen = new Map<string, number>();
	return anchors.map((a) => {
		const n = seen.get(linkName(a.link)) ?? 0;
		seen.set(linkName(a.link), n + 1);
		return { ...a, key: `${linkName(a.link)}#${n}` };
	});
}

export function segmentsFor(anchor: Anchor): Segment[] {
	if (!anchor.loops) {
		return [{ anchorKey: anchor.key, link: anchor.link, start: 0, end: null, label: "", rangeText: "", section: 0 }];
	}
	const { block } = anchor.loops;
	const indexes = block.select !== null ? [block.select] : block.sections.map((_, i) => i);
	return indexes.map((i) => {
		const s = block.sections[i];
		// An open-ended section runs to the next section's start, if any.
		const next = block.sections[i + 1];
		const end = s.end ?? (next && next.start > s.start ? next.start : null);
		return { anchorKey: anchor.key, link: anchor.link, start: s.start, end, label: s.name, rangeText: s.rangeText, section: i + 1 };
	});
}

/**
 * The stretch to analyse: up to `maxSeconds` from the segment's start, kept
 * inside the segment and the file.
 */
export function analysisWindow(segment: Segment, duration: number, maxSeconds: number): { start: number; end: number } {
	const start = Math.min(segment.start, duration);
	const segEnd = Math.min(segment.end ?? duration, duration);
	const end = maxSeconds > 0 ? Math.min(segEnd, start + maxSeconds) : segEnd;
	return { start, end };
}

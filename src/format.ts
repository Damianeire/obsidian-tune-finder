// Turning chosen matches into note text, and writing that text under the
// right embed or loops block. Pure functions; no Obsidian imports.
import { cleanLabel, formatTime, isPlaceholderLabel, setSectionLabel, type LoopSection } from "./loops.ts";
import { namesMatch } from "./names.ts";
import { findAnchors, type Anchor, type Segment } from "./note-scan.ts";

/** A search result from the engine. */
export interface Candidate {
	setting_id: string;
	tune_id: string;
	/** FolkFriend's display alias, e.g. "silver spear, the". */
	name: string;
	score: number;
	dance: string;
	meter: string;
	mode: string;
	/** All known names for the tune. */
	aliases: string[];
}

/** What the user picked for a segment. `note` is a matching vault note's name. */
export interface Choice {
	segment: Segment;
	candidate: Candidate;
	title: string;
	note: string | null;
}

const MODE_SUFFIX: Record<string, string> = {
	major: "",
	minor: " min",
	dorian: " dor",
	mixolydian: " mix",
	lydian: " lyd",
	phrygian: " phr",
	locrian: " loc",
};

/** "Edorian" -> "E dor", "Dmajor" -> "D", as in the vault's `key` property. */
export function formatKey(mode: string): string {
	const m = mode.match(/^([A-G][b#]?)(major|minor|dorian|mixolydian|lydian|phrygian|locrian)$/i);
	if (!m) return mode;
	return m[1] + MODE_SUFFIX[m[2].toLowerCase()];
}

/** "slip jig" -> "Slip Jig", "three-two" -> "Three-Two", as in the vault's `type` property. */
export function formatDance(dance: string): string {
	return dance.replace(/(^|[\s-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export function sessionUrl(c: Candidate): string {
	return `https://thesession.org/tunes/${c.tune_id}#setting${c.setting_id}`;
}

/** "[[The Silver Spear]], Reel, D ([thesession](...))" */
export function formatChoice(choice: Choice): string {
	const name = choice.note ? `[[${choice.note}]]` : choice.title;
	const details = [formatDance(choice.candidate.dance), formatKey(choice.candidate.mode)].filter(Boolean).join(", ");
	return `${name}${details ? `, ${details}` : ""} ([thesession](${sessionUrl(choice.candidate)}))`;
}

/** "2:18 - 4:34.3: ", with the section's label when it says something the pick doesn't. */
function segmentPrefix(c: Choice): string {
	const s = c.segment;
	if (!s.rangeText) return "";
	const showLabel = s.label && !isPlaceholderLabel(s.label) && !namesMatch(s.label, c.title);
	return showLabel ? `${s.rangeText} (${s.label}): ` : `${s.rangeText}: `;
}

/** Plain-text lines for copying, one per choice. */
export function formatPlain(choices: Choice[]): string {
	return choices.map((c) => `${segmentPrefix(c)}${formatChoice(c)}`).join("\n");
}

// Lines written by an earlier run. Only lines with this plugin's own
// thesession.org links are treated as earlier results, so a list of your
// own straight after the block is never touched.
const OUR_LINK = /\(\[thesession\]\(https:\/\/thesession\.org\/tunes\/\d+/;
const SINGLE_RESULT = /^Identified tune: /;
const LIST_HEADER = /^Identified tunes:\s*$/;
const LIST_ITEM_RESULT = /^- /;
const NESTED_RESULT = /^\s+[-*+]\s+Identified tune: /;

/** Lines for one anchor's results. */
function resultLines(anchor: Anchor, choices: Choice[], hasSections: boolean): string[] {
	if (anchor.listIndent !== null) {
		const indent = `${anchor.listIndent}\t`;
		return choices.map((c) => `${indent}- Identified tune: ${segmentPrefix(c)}${formatChoice(c)}`);
	}
	if (!hasSections) return [`Identified tune: ${formatChoice(choices[0])}`];
	return ["Identified tunes:", ...choices.map((c) => `- ${segmentPrefix(c)}${formatChoice(c)}`)];
}

/** A new loops block for a scanned recording, named with the picks where there are any. */
function loopsBlockLines(detected: DetectedSections, choices: Choice[], nameLoops: boolean): string[] {
	return [
		"```loops",
		`file: ${detected.file}`,
		...detected.sections.map((s, i) => {
			const pick = choices.find((c) => c.segment.section === i + 1);
			const name = nameLoops && pick ? cleanLabel(pick.title) : `Tune ${i + 1}`;
			return `${formatTime(s.start)} - ${formatTime(s.end)} | ${name}`;
		}),
		"```",
	];
}

/** How many lines after `line` hold results from an earlier run. */
function previousResultLength(lines: string[], line: number, anchor: Anchor): number {
	const at = (i: number) => (lines[line + 1 + i] ?? "").replace(/\r$/, "");
	let n = 0;
	if (anchor.listIndent !== null) {
		while (line + 1 + n < lines.length && NESTED_RESULT.test(at(n)) && OUR_LINK.test(at(n))) n++;
		return n;
	}
	if (SINGLE_RESULT.test(at(0)) && OUR_LINK.test(at(0))) return 1;
	if (!LIST_HEADER.test(at(0))) return 0;
	n = 1;
	while (line + 1 + n < lines.length && LIST_ITEM_RESULT.test(at(n)) && OUR_LINK.test(at(n))) n++;
	return n;
}

/** Tune changes found by scanning a recording that has no loops block. */
export interface DetectedSections {
	/** Vault path of the recording, for the new block's `file:` line. */
	file: string;
	/** Seconds. */
	sections: { start: number; end: number }[];
}

export interface InsertOptions {
	/** Write the chosen names into loop sections nobody has named yet ("Tune 1", "Tune 2 ?"). */
	nameLoops: boolean;
	/** Add an "Identified tunes:" list with type, key and thesession.org links. */
	addList: boolean;
	/** For scanned recordings, by anchor key: a new loops block to write under the embed. */
	detected?: Map<string, DetectedSections>;
}

export interface InsertResult {
	text: string;
	/** Anchor keys that are no longer in the note. */
	missing: string[];
	/** Loop sections given a name. */
	named: number;
	/** Tunes added to lists. */
	listed: number;
	/** New loops blocks written. */
	blocks: number;
}

/**
 * Write choices into the note text under their anchors: names into loop
 * sections, new loops blocks for scanned recordings, and the list of
 * identified tunes. Sections someone already named are left alone, and a
 * list from an earlier run is replaced, so running again is safe. Anchors
 * are matched by key, so this works on the note's current text even if
 * lines moved since the segments were found.
 */
export function insertChoices(text: string, choices: Choice[], opts: InsertOptions = { nameLoops: false, addList: true }): InsertResult {
	const crlf = text.includes("\r\n");
	const lines = text.split("\n");
	const anchors = findAnchors(text);
	const detected = opts.detected ?? new Map<string, DetectedSections>();
	const byKey = new Map<string, Choice[]>();
	for (const c of choices) {
		const list = byKey.get(c.segment.anchorKey) ?? [];
		list.push(c);
		byKey.set(c.segment.anchorKey, list);
	}
	const result: InsertResult = { text, missing: [], named: 0, listed: 0, blocks: 0 };
	for (const key of new Set([...byKey.keys(), ...detected.keys()])) {
		if (!anchors.some((a) => a.key === key)) result.missing.push(key);
	}
	const withCr = (add: string[]) => (crlf ? add.map((l) => `${l}\r`) : add);

	// Bottom up, so earlier line numbers stay valid.
	const targets = anchors
		.filter((a) => byKey.has(a.key) || detected.has(a.key))
		.sort((a, b) => b.insertAfterLine - a.insertAfterLine);
	for (const anchor of targets) {
		const list = (byKey.get(anchor.key) ?? []).sort((a, b) => a.segment.start - b.segment.start);

		// Names into an existing block's sections. Only the line's label
		// changes, so no line numbers move.
		if (anchor.loops && opts.nameLoops) {
			for (const c of list) {
				const loop: LoopSection | undefined = anchor.loops.block.sections[c.segment.section - 1];
				if (!loop || !isPlaceholderLabel(loop.name)) continue;
				const i = anchor.loops.startLine + 1 + loop.line;
				const cr = lines[i].endsWith("\r") ? "\r" : "";
				lines[i] = setSectionLabel(lines[i].replace(/\r$/, ""), c.title) + cr;
				result.named++;
			}
		}

		const newBlock = !anchor.loops && anchor.listIndent === null ? detected.get(anchor.key) : undefined;
		const listing = opts.addList && list.length > 0;
		if (!newBlock && !listing) continue;

		const at = anchor.insertAfterLine;
		const remove = listing ? previousResultLength(lines, at, anchor) : 0;
		const add: string[] = [];
		if (newBlock) {
			add.push(...loopsBlockLines(newBlock, list, opts.nameLoops));
			result.blocks++;
			if (opts.nameLoops) result.named += newBlock.sections.filter((_, i) => list.some((c) => c.segment.section === i + 1)).length;
		}
		if (listing) {
			add.push(...resultLines(anchor, list, Boolean(anchor.loops || newBlock)));
			result.listed += list.length;
		}
		// A blank line after what was added keeps whatever follows from running on into it.
		const after = lines[at + 1 + remove];
		if (anchor.listIndent === null && after !== undefined && after.trim() !== "") add.push("");
		lines.splice(at + 1, remove, ...withCr(add));
	}
	result.text = lines.join("\n");
	return result;
}

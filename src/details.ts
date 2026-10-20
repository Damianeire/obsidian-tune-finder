// Suggesting `type` and `key` for tune notes that are missing them. Pure
// functions; the caller looks up names and identifies recordings.
//
// The best evidence is the note's own recording: if it matches a tune with
// the note's name, the type and key come from that, and the key is the one
// it is actually played in. Failing that, a name that only one tune on
// thesession.org has gives that tune's usual type and key. When several
// tunes share the name, only the type they all agree on is suggested,
// unticked (their keys were right only 72% of the time in testing).
//
// A tune type in the note's own name ("Cathedral Jig", "Claudia's Waltz")
// beats everything: in testing, most wrong types came from a different tune
// that shares the rest of the name. A match that contradicts the name's
// type doesn't get to suggest a key either.
import type { TuneInfo } from "./engine-protocol.ts";
import { formatDance, formatKey, type Candidate } from "./format.ts";
import { namesMatch } from "./names.ts";
import { findAnchors, segmentsFor, type Segment } from "./note-scan.ts";

export interface Needs {
	type: boolean;
	key: boolean;
}

export interface Heard {
	/** The recording's match that has the note's name. */
	candidate: Candidate;
	/** Semitones off concert pitch, as found by the search (0 when in tune). */
	detune: number;
}

export interface Suggestion {
	/** Value to write, or null to leave the field alone. */
	type: string | null;
	key: string | null;
	/** Where it came from, for the reader. */
	source: string;
	/** Ticked by default. */
	confident: boolean;
	tuneId: string;
}

/** Frontmatter values that count as "not filled in". */
export function isEmptyValue(value: unknown): boolean {
	if (value === undefined || value === null) return true;
	if (typeof value === "string") return value.trim() === "";
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

function mostCommon(values: string[]): string | null {
	const counts = new Map<string, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	let best: string | null = null;
	for (const [v, n] of counts) if (best === null || n > counts.get(best)!) best = v;
	return best;
}

/** A tune's usual type and key: the most common across its settings. */
export function usualDetails(tune: TuneInfo): { type: string | null; key: string | null } {
	const dance = mostCommon(tune.settings.map((s) => s.dance));
	const mode = mostCommon(tune.settings.map((s) => s.mode));
	return { type: dance ? formatDance(dance) : null, key: mode ? formatKey(mode) : null };
}

/** The match among the first few that has one of these names. */
export function heardTune(candidates: Candidate[], names: string[], top = 5): Candidate | null {
	return candidates.slice(0, top).find((c) => c.aliases.some((a) => names.some((n) => namesMatch(a, n)))) ?? null;
}

/**
 * The stretch of the note's audio that is the note's own tune: the loop
 * section picked by `select:`, or the section labelled with its name, or a
 * recording with no loops at all.
 */
export function ownTuneSegment(text: string, names: string[]): Segment | null {
	const anchors = findAnchors(text);
	for (const a of anchors) {
		if (a.loops?.block.select != null) return segmentsFor(a)[0];
	}
	for (const a of anchors) {
		if (!a.loops) continue;
		const labelled = segmentsFor(a).find((s) => s.label && names.some((n) => namesMatch(s.label, n)));
		if (labelled) return labelled;
	}
	const plain = anchors.find((a) => !a.loops);
	return plain ? segmentsFor(plain)[0] : null;
}

const TYPE_IN_NAME: [RegExp, string][] = [
	[/\bslip jig\b/i, "Slip Jig"],
	[/\bsingle reel\b/i, "Single Reel"],
	[/\bset dance\b/i, "Set Dance"],
	[/\bslow air\b/i, "Slow Air"],
	[/\bbarn ?dance\b/i, "Barndance"],
	[/\breel\b/i, "Reel"],
	[/\bjig\b/i, "Jig"],
	[/\bhornpipe\b/i, "Hornpipe"],
	[/\bpol[kc]a\b/i, "Polka"],
	[/\bslide\b/i, "Slide"],
	[/\bwaltz\b/i, "Waltz"],
	[/\bmazurka\b/i, "Mazurka"],
	[/\bmarch\b/i, "March"],
];

/** The tune type a note's name gives, e.g. "Jig" for "Cathedral Jig". */
export function typeInName(name: string): string | null {
	for (const [re, type] of TYPE_IN_NAME) if (re.test(name)) return type;
	return null;
}

// Rhythm families: types in the same family are easily filed as each other
// (a 6/8 march as a jig, a single reel as a reel).
const FAMILIES: Record<string, string[]> = {
	reel: ["duple"],
	"single reel": ["duple"],
	hornpipe: ["duple"],
	barndance: ["duple"],
	polka: ["duple"],
	strathspey: ["duple"],
	march: ["duple", "compound"],
	"set dance": ["duple", "compound"],
	jig: ["compound"],
	slide: ["compound"],
	"slip jig": ["slip"],
	waltz: ["triple"],
	mazurka: ["triple"],
	"three-two": ["three-two"],
	"slow air": ["air"],
};

export function sameFamily(a: string, b: string): boolean {
	const fa = FAMILIES[a.toLowerCase()] ?? [a.toLowerCase()];
	const fb = FAMILIES[b.toLowerCase()] ?? [b.toLowerCase()];
	return fa.some((f) => fb.includes(f));
}

/**
 * What to suggest for a note called `noteName`, given the tunes that share
 * its name and, if its recording was identified, the match that has its
 * name. Returns null with a reason when there is nothing worth suggesting.
 */
export function suggestDetails(needs: Needs, byName: TuneInfo[], heard: Heard | null, noteName: string): { suggestion: Suggestion | null; reason: string } {
	if (!needs.type && !needs.key) return { suggestion: null, reason: "Already has a type and key" };
	const nameType = typeInName(noteName);
	const make = (type: string | null, key: string | null, source: string, confident: boolean, tuneId: string) => {
		type = needs.type ? type : null;
		key = needs.key ? key : null;
		if (!type && !key) return { suggestion: null, reason: "Nothing to suggest for the missing field" };
		return { suggestion: { type, key, source, confident, tuneId }, reason: "" };
	};

	if (heard) {
		const c = heard.candidate;
		const heardType = formatDance(c.dance);
		if (nameType && !sameFamily(nameType, heardType)) {
			return make(nameType, null, `From its name; the recording matched a ${heardType.toLowerCase()} of that name, so no key`, true, c.tune_id);
		}
		const tune = byName.find((t) => t.tune_id === c.tune_id);
		if (heard.detune === 0) return make(nameType ?? heardType, formatKey(c.mode), "Matched your recording", true, c.tune_id);
		return make(
			nameType ?? heardType,
			tune ? usualDetails(tune).key : formatKey(c.mode),
			"Matched your recording; it isn't at concert pitch, so the key is thesession.org's usual one",
			true,
			c.tune_id
		);
	}

	const spelling = byName.length > 0 && byName.every((t) => t.matchedBy === "spelling");
	const by = spelling ? "By a close spelling of its name on thesession.org" : "By name on thesession.org";

	if (byName.length === 1) {
		const usual = usualDetails(byName[0]);
		if (nameType && usual.type !== nameType) {
			return make(nameType, null, `From its name; the tune of that name on thesession.org is a ${usual.type?.toLowerCase()}, so no key`, true, byName[0].tune_id);
		}
		return make(nameType ?? usual.type, usual.key, by, !spelling, byName[0].tune_id);
	}

	if (byName.length > 1) {
		if (nameType) return make(nameType, null, `From its name (${byName.length} tunes on thesession.org share it)`, true, byName[0].tune_id);
		const types = byName.map((t) => usualDetails(t).type);
		if (types.every((t) => t === types[0]) && types[0]) {
			return make(types[0], null, `${byName.length} tunes on thesession.org have this name; they are all ${types[0].toLowerCase()}s`, false, byName[0].tune_id);
		}
		return { suggestion: null, reason: `${byName.length} tunes on thesession.org have this name, and they differ` };
	}

	if (nameType) return make(nameType, null, "From its name", true, "");
	return { suggestion: null, reason: "No tune on thesession.org has this name" };
}

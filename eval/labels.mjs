// Ground-truth labels for the evaluation: what tune(s) a recording holds,
// taken from its file name and from the tune notes that embed it.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const UNLABELLED = /whatsapp|^(new )?recording|^audio\b|^voice memo|^track \d|^\d{6,}/i;
const INSTRUMENT_SUFFIX =
	/\s+on\s+(the\s+)?(tenor\s+)?(banjo|concertina|fiddle|flute|whistle|tin whistle|box|accordion|guitar|mandolin|pipes|uilleann pipes|harp|piano)\b.*$/i;

/** Tune names suggested by a file name such as "Tim Maloney's+Bird in the Bush.mp3". */
export function labelsFromFilename(file) {
	let s = basename(file).replace(/\.[^.]+$/, "");
	if (UNLABELLED.test(s)) return [];
	s = s.split(/[｜|]/)[0];
	s = s.replace(/\([^)]*\)/g, " ").replace(INSTRUMENT_SUFFIX, "");
	const labels = new Set();
	for (const part of s.split(/\s*\+\s*/)) {
		const p = part.trim();
		if (!p) continue;
		labels.add(p);
		// "Artist - Tune" names: also try each side.
		for (const side of p.split(/\s+-\s+/)) if (side.trim() && side !== p) labels.add(side.trim());
	}
	return [...labels];
}

/** Map of audio file basename -> titles of tune notes that embed it. */
export function embedTitles(tuneNotesDir) {
	const map = new Map();
	for (const f of readdirSync(tuneNotesDir)) {
		if (!f.endsWith(".md")) continue;
		const text = readFileSync(join(tuneNotesDir, f), "utf8");
		const title = f.replace(/\.md$/, "");
		for (const m of text.matchAll(/!\[\[([^\]|#]+\.(?:mp3|m4a|wav|ogg|flac))/gi)) {
			const key = basename(m[1]);
			if (!map.has(key)) map.set(key, new Set());
			map.get(key).add(title);
		}
	}
	return map;
}

// Searching with pitch correction, on top of FolkFriend's query.
//
// FolkFriend matches absolute pitch, and only corrects transcriptions that
// come out an octave too high (tin whistle). In testing against real
// recordings two other cases were common:
// - tenor banjo and other low instruments, transcribed an octave below the
//   tunes in the index;
// - recordings a semitone or a tone away from concert pitch (flat pipes,
//   instruments tuned down, sped-up or slowed-down audio).
// So the contour is first moved to the octave the index uses, and when the
// result is weak, nearby transpositions are tried too. A transposed result
// only wins when it is clearly better.
//
// Pure functions; the caller passes in the engine's query.

/** FolkFriend's contour alphabet: one character per MIDI pitch from 48 to 95. */
export const CONTOUR_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV";
const MIDI_LOW = 48;

/** Median pitch of the settings in thesession.org's index (B4). */
export const INDEX_MEDIAN_PITCH = 71;

export interface Scored {
	score: number;
}

export type Confidence = "likely" | "possible" | "unsure";

// From the evaluation against labelled recordings: right answers had a top
// score of 0.34 or more 90% of the time, and wrong ones 0.31 or less; the
// lead over the second result was 0.12 or more for right answers and 0.09 or
// less for wrong ones.
const LIKELY_SCORE = 0.4;
const LIKELY_MARGIN = 0.1;
const POSSIBLE_SCORE = 0.3;
/** How much a transposed search must beat the untransposed one by. */
const TRANSPOSE_GAIN = 0.15;

export function confidence(results: Scored[]): Confidence {
	const top = results[0]?.score ?? 0;
	const margin = top - (results[1]?.score ?? 0);
	if (top >= LIKELY_SCORE && margin >= LIKELY_MARGIN) return "likely";
	if (top >= POSSIBLE_SCORE) return "possible";
	return "unsure";
}

export function contourPitches(contour: string): number[] {
	const out: number[] = [];
	for (const ch of contour) {
		const i = CONTOUR_CHARS.indexOf(ch);
		if (i >= 0) out.push(MIDI_LOW + i);
	}
	return out;
}

export function medianPitch(contour: string): number {
	const p = contourPitches(contour).sort((a, b) => a - b);
	return p.length ? p[p.length >> 1] : INDEX_MEDIAN_PITCH;
}

/** Move every note by `semitones`, keeping notes inside the alphabet's range. */
export function transpose(contour: string, semitones: number): string {
	if (semitones === 0) return contour;
	let out = "";
	for (const ch of contour) {
		const i = CONTOUR_CHARS.indexOf(ch);
		if (i < 0) continue;
		let j = i + semitones;
		while (j < 0) j += 12;
		while (j >= CONTOUR_CHARS.length) j -= 12;
		out += CONTOUR_CHARS[j];
	}
	return out;
}

/** Whole octaves that bring the contour's median closest to the index's. */
export function octaveCorrection(contour: string): number {
	return 12 * Math.round((INDEX_MEDIAN_PITCH - medianPitch(contour)) / 12);
}

export interface SearchOutcome<T extends Scored> {
	results: T[];
	/** Semitones the transcription was moved by, octave correction included. */
	shift: number;
	/** Semitones away from the transcription's own octave-corrected pitch: 0 when in tune. */
	detune: number;
	confidence: Confidence;
	queries: number;
}

/**
 * Search, correcting octave and pitch. `hint` is a shift (semitones) that
 * worked for a neighbouring stretch of the same recording; it is tried
 * first, and kept if it gives a likely match. With `explore` off, a weak
 * result isn't retried at other pitches (scanning uses this to stay quick).
 */
export function searchWithCorrection<T extends Scored>(
	contour: string,
	query: (contour: string) => T[],
	hint: number | null = null,
	explore = true
): SearchOutcome<T> {
	const octave = octaveCorrection(contour);
	// Semitones away from the octave-corrected pitch, in -6..6.
	const detuneOf = (shift: number) => {
		const d = shift - octave;
		return d - 12 * Math.round(d / 12);
	};
	let queries = 0;
	if (hint !== null) {
		const hinted = query(transpose(contour, hint));
		queries++;
		const conf = confidence(hinted);
		if (conf === "likely") return { results: hinted, shift: hint, detune: detuneOf(hint), confidence: conf, queries };
	}

	const base = query(transpose(contour, octave));
	queries++;
	let best: SearchOutcome<T> = { results: base, shift: octave, detune: 0, confidence: confidence(base), queries };
	if (best.confidence === "likely" || !explore) return best;

	const baseTop = base[0]?.score ?? 0;
	for (const extra of [-1, 1, -2, 2, 12, -12]) {
		const results = query(transpose(contour, octave + extra));
		queries++;
		const top = results[0]?.score ?? 0;
		if (top >= Math.max(LIKELY_SCORE, baseTop + TRANSPOSE_GAIN) && top > (best.results[0]?.score ?? 0)) {
			best = { results, shift: octave + extra, detune: detuneOf(octave + extra), confidence: confidence(results), queries };
		}
	}
	best.queries = queries;
	return best;
}

// Finding the tune changes in a recording that has no loops block, by
// identifying overlapping windows along it and smoothing the answers.
//
// Each window is identified on its own. Then a Viterbi pass picks one tune
// per window, rewarding each window's match score and charging a penalty
// for every change of tune. This means one odd window, or a bar of chat,
// doesn't split a tune, while a real change, which every later window
// agrees on, does. Runs of the same tune become sections. A window that
// straddles a change matches neither tune well, so a boundary lands between
// the centres of the last window of one tune and the first of the next.
//
// Pure apart from the `slice` and `identify` functions passed in, so the
// evaluation script runs exactly what the plugin runs.

export interface ScanCandidate {
	tune_id: string;
	score: number;
}

export interface WindowResult {
	start: number;
	end: number;
	candidates: ScanCandidate[];
}

export interface FoundSection {
	start: number;
	end: number;
	/** The tune the windows agreed on, or null where nothing matched. */
	tuneId: string | null;
}

export interface ScanOptions {
	/** Seconds of audio per window. */
	windowSeconds: number;
	/** Seconds between window starts. */
	hopSeconds: number;
	/** Score given up for each change of tune. */
	switchPenalty: number;
	/** Per-window score of "no tune": windows that match nothing better than this. */
	unknownScore: number;
	/** Sections shorter than this are merged into a neighbour. */
	minSectionSeconds: number;
}

export const DEFAULT_SCAN: ScanOptions = {
	windowSeconds: 30,
	hopSeconds: 10,
	switchPenalty: 0.5,
	unknownScore: 0.2,
	minSectionSeconds: 30,
};

/** Window start and end times covering the recording. The last window ends at the end. */
export function scanWindows(duration: number, opts: ScanOptions = DEFAULT_SCAN): { start: number; end: number }[] {
	const { windowSeconds: w, hopSeconds: hop } = opts;
	if (duration <= w) return [{ start: 0, end: duration }];
	const out: { start: number; end: number }[] = [];
	for (let start = 0; start + w <= duration + 1e-6; start += hop) out.push({ start, end: start + w });
	const last = out[out.length - 1];
	if (duration - last.end > hop / 2) out.push({ start: duration - w, end: duration });
	return out;
}

const UNKNOWN = "";

/** The tune for each window, by Viterbi. UNKNOWN ("") for no tune. */
export function smoothWindows(windows: WindowResult[], opts: ScanOptions = DEFAULT_SCAN): string[] {
	if (windows.length === 0) return [];
	const states = [UNKNOWN, ...new Set(windows.flatMap((w) => w.candidates.map((c) => c.tune_id)))];
	const emission = (t: number, s: string): number => {
		if (s === UNKNOWN) return opts.unknownScore;
		const cands = windows[t].candidates;
		const hit = cands.find((c) => c.tune_id === s);
		if (hit) return hit.score;
		// Not in this window's list: at most the lowest score listed.
		return cands.length ? cands[cands.length - 1].score * 0.9 : 0;
	};

	let prev = states.map((s) => emission(0, s));
	const back: number[][] = [];
	for (let t = 1; t < windows.length; t++) {
		let bestPrev = 0;
		for (let i = 1; i < prev.length; i++) if (prev[i] > prev[bestPrev]) bestPrev = i;
		const cur: number[] = [];
		const from: number[] = [];
		for (let i = 0; i < states.length; i++) {
			const stay = prev[i];
			const change = prev[bestPrev] - opts.switchPenalty;
			if (stay >= change) {
				cur.push(stay + emission(t, states[i]));
				from.push(i);
			} else {
				cur.push(change + emission(t, states[i]));
				from.push(bestPrev);
			}
		}
		back.push(from);
		prev = cur;
	}
	let best = 0;
	for (let i = 1; i < prev.length; i++) if (prev[i] > prev[best]) best = i;
	const path = [best];
	for (let t = back.length - 1; t >= 0; t--) path.push(back[t][path[path.length - 1]]);
	return path.reverse().map((i) => states[i]);
}

/** Group a per-window path into sections, merging short ones into a neighbour. */
export function sectionsFromPath(windows: { start: number; end: number }[], path: string[], duration: number, opts: ScanOptions = DEFAULT_SCAN): FoundSection[] {
	if (windows.length === 0) return [];
	const centre = (t: number) => (windows[t].start + windows[t].end) / 2;
	const states = [...path];

	for (;;) {
		// Runs of equal states, as [first window, last window].
		const runs: [number, number][] = [];
		for (let t = 0; t < states.length; t++) {
			if (t > 0 && states[t] === states[t - 1]) runs[runs.length - 1][1] = t;
			else runs.push([t, t]);
		}
		if (runs.length === 1) break;
		const bounds = (r: number): [number, number] => [
			r === 0 ? 0 : (centre(runs[r - 1][1]) + centre(runs[r][0])) / 2,
			r === runs.length - 1 ? duration : (centre(runs[r][1]) + centre(runs[r + 1][0])) / 2,
		];
		// The shortest run under the minimum joins its longer neighbour.
		let shortest = -1;
		let shortestLength = Infinity;
		runs.forEach((_, r) => {
			const [a, b] = bounds(r);
			if (b - a < opts.minSectionSeconds && b - a < shortestLength) {
				shortest = r;
				shortestLength = b - a;
			}
		});
		if (shortest < 0) {
			return runs.map((run, r) => {
				const [start, end] = bounds(r);
				const tuneId = states[run[0]];
				return { start, end, tuneId: tuneId === UNKNOWN ? null : tuneId };
			});
		}
		const [first, last] = runs[shortest];
		const before = shortest > 0 ? runs[shortest - 1] : null;
		const after = shortest < runs.length - 1 ? runs[shortest + 1] : null;
		const length = (run: [number, number] | null) => (run ? run[1] - run[0] + 1 : -1);
		const into = !after || (before && length(before) >= length(after)) ? before! : after;
		for (let t = first; t <= last; t++) states[t] = states[into[0]];
	}
	const tuneId = states[0];
	return [{ start: 0, end: duration, tuneId: tuneId === UNKNOWN ? null : tuneId }];
}

export interface Identifier {
	(pcm: Float32Array, hint: number | null, explore: boolean): Promise<{ candidates: ScanCandidate[]; shift: number; likely: boolean }>;
}

/**
 * Identify windows along a recording and return its sections.
 * `slice(start, end)` gives mono samples; `identify` searches one window.
 * It gets the transposition that last gave a likely match as a hint, so an
 * off-pitch recording costs one search per window, not seven. Weak windows
 * (chat, a change of tune) are only retried at other pitches at the start
 * and on every third weak window in a row, which keeps scanning quick.
 */
export async function scanRecording(
	duration: number,
	slice: (start: number, end: number) => Float32Array,
	identify: Identifier,
	onProgress: (done: number, total: number) => void = () => {},
	isCancelled: () => boolean = () => false,
	opts: ScanOptions = DEFAULT_SCAN
): Promise<{ sections: FoundSection[]; windows: WindowResult[] }> {
	const times = scanWindows(duration, opts);
	const windows: WindowResult[] = [];
	let hint: number | null = null;
	let weak = 0;
	for (let i = 0; i < times.length; i++) {
		if (isCancelled()) break;
		onProgress(i, times.length);
		const { start, end } = times[i];
		let candidates: ScanCandidate[] = [];
		let likely = false;
		try {
			const r = await identify(slice(start, end), hint, i < 3 || weak % 3 === 2);
			candidates = r.candidates;
			likely = r.likely;
			if (likely) hint = r.shift;
		} catch {
			// No notes in this window (chat, tuning up): it matches nothing.
		}
		weak = likely ? 0 : weak + 1;
		windows.push({ start, end, candidates });
	}
	onProgress(times.length, times.length);
	const path = smoothWindows(windows, opts);
	return { sections: sectionsFromPath(times.slice(0, windows.length), path, duration, opts), windows };
}

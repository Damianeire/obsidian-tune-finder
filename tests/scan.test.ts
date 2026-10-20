import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCAN, scanRecording, scanWindows, sectionsFromPath, smoothWindows, type WindowResult } from "../src/scan.ts";

const opts = { ...DEFAULT_SCAN, windowSeconds: 30, hopSeconds: 10, switchPenalty: 0.5, unknownScore: 0.2, minSectionSeconds: 30 };

/** Windows along a recording where each window's best tune is given in order. */
function windowsFor(duration: number, tunes: (string | null)[], score = 0.6): WindowResult[] {
	return scanWindows(duration, opts).map((w, i) => {
		const t = tunes[i];
		return {
			...w,
			candidates: t ? [{ tune_id: t, score }, { tune_id: "other", score: 0.15 }] : [],
		};
	});
}

test("windows cover the recording, the last one ending at the end", () => {
	assert.deepEqual(scanWindows(20, opts), [{ start: 0, end: 20 }]);
	const w = scanWindows(100, opts);
	assert.equal(w.length, 8);
	assert.deepEqual(w[7], { start: 70, end: 100 });
	const longer = scanWindows(106, opts);
	assert.deepEqual(longer[longer.length - 1], { start: 76, end: 106 });
});

test("two tunes give two sections, split between the last window of one and the first of the next", () => {
	const duration = 140;
	const tunes = ["A", "A", "A", "A", "A", "A", "B", "B", "B", "B", "B", "B"];
	const windows = windowsFor(duration, tunes);
	const path = smoothWindows(windows, opts);
	assert.deepEqual(path, tunes);
	const sections = sectionsFromPath(windows, path, duration, opts);
	// Window 5 is centred at 65 s, window 6 at 75 s.
	assert.deepEqual(sections, [
		{ start: 0, end: 70, tuneId: "A" },
		{ start: 70, end: 140, tuneId: "B" },
	]);
});

test("one window that matches another tune doesn't split a tune", () => {
	const duration = 140;
	const windows = windowsFor(duration, ["A", "A", "A", "A", "A", "A", "A", "A", "A", "A", "A", "A"]);
	// Window 4 prefers B, a little.
	windows[4].candidates = [{ tune_id: "B", score: 0.45 }, { tune_id: "A", score: 0.4 }];
	const path = smoothWindows(windows, opts);
	assert.ok(path.every((s) => s === "A"));
	assert.deepEqual(sectionsFromPath(windows, path, duration, opts), [{ start: 0, end: 140, tuneId: "A" }]);
});

test("a short run is merged into its longer neighbour", () => {
	const duration = 140;
	const windows = windowsFor(duration, Array(12).fill("A"));
	const path = ["A", "A", "A", "A", "C", "A", "A", "A", "A", "A", "A", "B"];
	// C (one window, 10 s) joins A; so does B (the last window, 120 s to the end).
	assert.deepEqual(sectionsFromPath(windows, path, duration, opts), [{ start: 0, end: 140, tuneId: "A" }]);
	// Two windows at the end make 30 s, long enough to stand.
	const longer = ["A", "A", "A", "A", "A", "A", "A", "A", "A", "A", "B", "B"];
	assert.deepEqual(sectionsFromPath(windows, longer, duration, opts), [
		{ start: 0, end: 110, tuneId: "A" },
		{ start: 110, end: 140, tuneId: "B" },
	]);
});

test("stretches where nothing matches become sections with no tune when long enough", () => {
	const duration = 200;
	const tunes = ["A", "A", "A", "A", "A", "A", null, null, null, null, null, null, "B", "B", "B", "B", "B", "B"];
	const windows = windowsFor(duration, tunes);
	const sections = sectionsFromPath(windows, smoothWindows(windows, opts), duration, opts);
	assert.deepEqual(
		sections.map((s) => s.tuneId),
		["A", null, "B"]
	);
});

test("scanRecording passes the previous likely shift as a hint and survives windows with no notes", async () => {
	const hints: (number | null)[] = [];
	const explores: boolean[] = [];
	let call = 0;
	const { sections, windows } = await scanRecording(
		100,
		(start, end) => new Float32Array(Math.round((end - start) * 10)),
		async (_pcm, hint, explore) => {
			hints.push(hint);
			explores.push(explore);
			call++;
			if (call === 3) throw new Error("No notes heard");
			return { candidates: [{ tune_id: "A", score: 0.7 }], shift: 12, likely: true };
		},
		undefined,
		undefined,
		opts
	);
	assert.equal(windows.length, 8);
	assert.deepEqual(hints.slice(0, 3), [null, 12, 12]);
	// Retries at other pitches only for the first windows (later ones are likely).
	assert.deepEqual(explores, [true, true, true, false, false, false, false, false]);
	assert.equal(windows[2].candidates.length, 0);
	assert.deepEqual(sections, [{ start: 0, end: 100, tuneId: "A" }]);
});

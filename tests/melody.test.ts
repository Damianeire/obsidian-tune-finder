import { test } from "node:test";
import assert from "node:assert/strict";
import { contourFromIndexJson, melodyNotes, quaversPerSecond } from "../src/melody.ts";
import { CONTOUR_CHARS } from "../src/search.ts";

const at = (midi: number) => CONTOUR_CHARS[midi - 48];

test("melodyNotes holds a run of the same pitch as one note", () => {
	// |:FG|A3B ... as the index writes it: F G A A A B
	const contour = [66, 67, 69, 69, 69, 71].map(at).join("");
	const step = 1 / quaversPerSecond("reel");
	const notes = melodyNotes(contour, "reel");
	assert.deepEqual(
		notes.map((n) => n.midi),
		[66, 67, 69, 71]
	);
	assert.ok(Math.abs(notes[2].start - 2 * step) < 1e-9);
	assert.ok(Math.abs(notes[2].duration - 3 * step) < 1e-9);
});

test("melodyNotes transposes, and goes slower for a polka than a reel", () => {
	assert.equal(melodyNotes(at(62), "jig", 2)[0].midi, 64);
	assert.ok(quaversPerSecond("Polka") < quaversPerSecond("reel"));
	assert.ok(quaversPerSecond("unknown dance") > 0);
});

test("contourFromIndexJson finds a setting without matching tune ids or aliases", () => {
	const index = {
		settings: {
			"12": { tune_id: "278", meter: "4/4", mode: "Dmajor", abc: "", dance: "reel", contour: "abc" },
			"278": { tune_id: "5", meter: "6/8", mode: "Gmajor", abc: "", dance: "jig", contour: "xyz" },
		},
		aliases: { "12": ["a tune"], "278": ["johnny allen's"] },
	};
	const compact = JSON.stringify(index);
	assert.equal(contourFromIndexJson(compact, "278"), "xyz");
	assert.equal(contourFromIndexJson(compact, "12"), "abc");
	assert.equal(contourFromIndexJson(JSON.stringify(index, null, 1), "278"), "xyz");
	assert.equal(contourFromIndexJson(compact, "999"), "");
});

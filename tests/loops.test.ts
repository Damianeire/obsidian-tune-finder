import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, isPlaceholderLabel, parseLoopsBlock, parseTime, setSectionLabel } from "../src/loops.ts";

test("parseTime accepts the player's formats", () => {
	assert.equal(parseTime("0:00"), 0);
	assert.equal(parseTime("2:16.5"), 136.5);
	assert.equal(parseTime("1:02:03"), 3723);
	assert.equal(parseTime("42"), 42);
	assert.equal(parseTime("abc"), null);
});

test("formatTime keeps tenths only when needed", () => {
	assert.equal(formatTime(0), "0:00");
	assert.equal(formatTime(136.5), "2:16.5");
	assert.equal(formatTime(138), "2:18");
	assert.equal(formatTime(59.96), "1:00");
});

test("parseLoopsBlock reads a trad-split block", () => {
	const block = parseLoopsBlock(
		["file: Sound files/Joshua Dukes - Lucy FarrsHills of Tara.mp3", "0:00 - 2:16.5 | Tune 1", "2:16.5 - 4:39.4 | Tune 2 ?"].join("\n")
	);
	assert.equal(block.file, "Sound files/Joshua Dukes - Lucy FarrsHills of Tara.mp3");
	assert.deepEqual(block.errors, []);
	assert.equal(block.sections.length, 2);
	assert.deepEqual(block.sections[1], { name: "Tune 2 ?", start: 136.5, end: 279.4, rangeText: "2:16.5 - 4:39.4", line: 2 });
});

test("parseLoopsBlock reads select:, open ends, and reports bad lines", () => {
	const block = parseLoopsBlock(["select: 2 loop", "0:00 - 1:00", "1:00 -", "rubbish"].join("\n"));
	assert.equal(block.select, 1);
	assert.equal(block.sections[0].name, "");
	assert.equal(block.sections[1].end, null);
	assert.equal(block.errors.length, 1);
});

test("placeholder labels are trad-split's Tune N (with or without ?) or nothing", () => {
	for (const name of ["", "Tune 1", "Tune 12 ?", "tune 3?", "?"]) assert.ok(isPlaceholderLabel(name), name);
	for (const name of ["The Tap Room", "Tune 1 in G", "Killavil Reel", "Hugh Travers' in G"]) assert.ok(!isPlaceholderLabel(name), name);
});

test("setSectionLabel replaces only the label", () => {
	assert.equal(setSectionLabel("0:00 - 1:51.5 | Tune 1", "The Tap Room"), "0:00 - 1:51.5 | The Tap Room");
	assert.equal(setSectionLabel("  0:00 – 1:51.5|Tune 1", "X"), "  0:00 – 1:51.5 | X");
	assert.equal(setSectionLabel("1:00 -", "Y"), "1:00 - | Y");
});

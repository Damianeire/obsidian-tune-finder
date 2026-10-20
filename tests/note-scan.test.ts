import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisWindow, findAnchors, segmentsFor } from "../src/note-scan.ts";
import { ANDERSONS, HILL_OF_TARA } from "./fixtures.ts";

test("a loops block under an embed is one anchor, with a segment per section", () => {
	const anchors = findAnchors(HILL_OF_TARA);
	assert.equal(anchors.length, 1);
	const [a] = anchors;
	assert.equal(a.link, "Sound files/Joshua Dukes - Lucy FarrsHills of Tara.mp3");
	assert.equal(a.embedLine, 9);
	assert.equal(a.insertAfterLine, 14);
	const segs = segmentsFor(a);
	assert.deepEqual(
		segs.map((s) => [s.start, s.end, s.label, s.rangeText]),
		[
			[0, 136.5, "Tune 1", "0:00 - 2:16.5"],
			[136.5, 279.4, "Tune 2", "2:16.5 - 4:39.4"],
		]
	);
});

test("an embed without loops is one whole-recording segment; images are ignored", () => {
	const anchors = findAnchors(ANDERSONS);
	assert.equal(anchors.length, 1);
	assert.equal(anchors[0].link, "Anderson's.m4a");
	assert.equal(anchors[0].insertAfterLine, 11);
	const [seg] = segmentsFor(anchors[0]);
	assert.equal(seg.start, 0);
	assert.equal(seg.end, null);
	assert.equal(seg.rangeText, "");
});

test("select: limits the segments to the note's own section", () => {
	const text = ["![[Set 1.m4a]]", "```loops", "select: 2", "0:00 - 1:30 | Tune 1", "1:30 - 3:00 | Tune 2", "```"].join("\n");
	const segs = segmentsFor(findAnchors(text)[0]);
	assert.equal(segs.length, 1);
	assert.equal(segs[0].label, "Tune 2");
	assert.equal(segs[0].section, 2);
});

test("open-ended sections run to the next section's start", () => {
	const text = ["![[Set.m4a]]", "```loops", "0:00 - | A", "1:30 - | B", "```"].join("\n");
	const segs = segmentsFor(findAnchors(text)[0]);
	assert.equal(segs[0].end, 90);
	assert.equal(segs[1].end, null);
});

test("embeds in code blocks and frontmatter are not audio to identify", () => {
	const text = ["---", "cover: '![[x.mp3]]'", "---", "```", "![[y.mp3]]", "```", "![[z.mp3|Live]]"].join("\n");
	assert.deepEqual(
		findAnchors(text).map((a) => a.link),
		["z.mp3"]
	);
});

test("an embed in a list item records its indentation; repeated recordings get distinct keys", () => {
	const text = ["## Recordings", "- ![[20251122 The Silver Spear.mp3]] from [[20251122 The Clock Tavern 22]]", "\t- ![[Tune.mp3]]", "![[Tune.mp3]]"].join("\n");
	const anchors = findAnchors(text);
	assert.equal(anchors[0].listIndent, "");
	assert.equal(anchors[1].listIndent, "\t");
	assert.equal(anchors[2].listIndent, null);
	assert.deepEqual(
		anchors.map((a) => a.key),
		["20251122 the silver spear.mp3#0", "tune.mp3#0", "tune.mp3#1"]
	);
});

test("a loops block with a file: line and no embed still counts", () => {
	const text = ["Some text", "```loops", "file: Sessions/Set 2.m4a", "0:00 - 2:00 | Tune 1", "```"].join("\n");
	const [a] = findAnchors(text);
	assert.equal(a.link, "Sessions/Set 2.m4a");
	assert.equal(a.embedLine, -1);
});

test("analysisWindow stays inside the section and the file", () => {
	const seg = { anchorKey: "", link: "", start: 100, end: 130, label: "", rangeText: "x", section: 1 };
	assert.deepEqual(analysisWindow(seg, 300, 60), { start: 100, end: 130 });
	assert.deepEqual(analysisWindow({ ...seg, end: null }, 300, 60), { start: 100, end: 160 });
	assert.deepEqual(analysisWindow({ ...seg, end: null }, 120, 60), { start: 100, end: 120 });
	assert.deepEqual(analysisWindow({ ...seg, end: null }, 300, 0), { start: 100, end: 300 });
});

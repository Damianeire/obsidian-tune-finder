import { test } from "node:test";
import assert from "node:assert/strict";
import { formatChoice, formatDance, formatKey, insertChoices, type Candidate, type Choice, type DetectedSections } from "../src/format.ts";
import { findAnchors, segmentsFor } from "../src/note-scan.ts";
import { ANDERSONS, HILL_OF_TARA } from "./fixtures.ts";

function candidate(name: string, tuneId: string, dance = "reel", mode = "Dmajor"): Candidate {
	return { setting_id: `${tuneId}0`, tune_id: tuneId, name, score: 0.7, dance, meter: "4/4", mode, aliases: [name] };
}

function choicesFor(text: string, picks: [string, string | null, Candidate][]): Choice[] {
	const segs = findAnchors(text).flatMap(segmentsFor);
	return picks.map(([title, note, c], i) => ({ segment: segs[i], candidate: c, title, note }));
}

test("keys and dances use the vault's property style", () => {
	assert.equal(formatKey("Dmajor"), "D");
	assert.equal(formatKey("Aminor"), "A min");
	assert.equal(formatKey("Edorian"), "E dor");
	assert.equal(formatKey("Dmixolydian"), "D mix");
	assert.equal(formatDance("slip jig"), "Slip Jig");
	assert.equal(formatDance("three-two"), "Three-Two");
});

test("a choice links to the vault note when there is one, and to thesession", () => {
	const segs = segmentsFor(findAnchors(ANDERSONS)[0]);
	const c = candidate("anderson's", "1234");
	assert.equal(
		formatChoice({ segment: segs[0], candidate: c, title: "Anderson's", note: "Anderson's" }),
		"[[Anderson's]], Reel, D ([thesession](https://thesession.org/tunes/1234#setting12340))"
	);
	assert.equal(
		formatChoice({ segment: segs[0], candidate: c, title: "Anderson's", note: null }),
		"Anderson's, Reel, D ([thesession](https://thesession.org/tunes/1234#setting12340))"
	);
});

test("loop results go under the loops block, as a list with each section's times", () => {
	const choices = choicesFor(HILL_OF_TARA, [
		["Lucy Farr's", null, candidate("lucy farr's", "111", "barndance", "Gmajor")],
		["Hill of Tara", "Hill of Tara", candidate("hills of tara, the", "222", "barndance", "Gmajor")],
	]);
	const { text, missing } = insertChoices(HILL_OF_TARA, choices);
	assert.deepEqual(missing, []);
	const lines = text.split("\n");
	assert.equal(lines[14], "```");
	assert.equal(lines[15], "Identified tunes:");
	// "Tune 1" is only a placeholder, so it isn't repeated in the list.
	assert.equal(lines[16], "- 0:00 - 2:16.5: Lucy Farr's, Barndance, G ([thesession](https://thesession.org/tunes/111#setting1110))");
	assert.equal(lines[17], "- 2:16.5 - 4:39.4: [[Hill of Tara]], Barndance, G ([thesession](https://thesession.org/tunes/222#setting2220))");
	assert.equal(lines[18], "");
	assert.equal(lines[20], "### Music");
	// Practice dates are untouched.
	assert.ok(text.endsWith("20230804\n"));
});

test("running again replaces the earlier results instead of adding more", () => {
	const first = insertChoices(HILL_OF_TARA, choicesFor(HILL_OF_TARA, [["A", null, candidate("a", "1")], ["B", null, candidate("b", "2")]])).text;
	// Only one section picked the second time.
	const second = insertChoices(first, choicesFor(first, [["C", null, candidate("c", "3")]])).text;
	assert.equal((second.match(/Identified tunes:/g) ?? []).length, 1);
	assert.ok(second.includes("- 0:00 - 2:16.5: C,"));
	assert.ok(!second.includes("A, Reel"));
	assert.ok(!second.includes("B, Reel"));
	// And a third run with the same picks changes nothing.
	assert.equal(insertChoices(second, choicesFor(second, [["C", null, candidate("c", "3")]])).text, second);
});

test("a single recording gets one line under its embed, separated from a following paragraph", () => {
	const choices = choicesFor(ANDERSONS, [["Anderson's", "Anderson's", candidate("anderson's", "9")]]);
	const text = insertChoices(ANDERSONS, choices).text;
	const lines = text.split("\n");
	assert.equal(lines[11], "![[Anderson's.m4a]]");
	assert.equal(lines[12], "Identified tune: [[Anderson's]], Reel, D ([thesession](https://thesession.org/tunes/9#setting90))");
	assert.equal(lines[13], "");
	assert.equal(lines[14], "20260926");

	const tight = "![[x.mp3]]\nSome words\n";
	const out = insertChoices(tight, choicesFor(tight, [["X", null, candidate("x", "5")]])).text;
	assert.equal(out, "![[x.mp3]]\nIdentified tune: X, Reel, D ([thesession](https://thesession.org/tunes/5#setting50))\n\nSome words\n");
});

test("an embed inside a list item gets a nested item", () => {
	const text = "## Recordings\n- ![[20251122 The Silver Spear.mp3]] from [[20251122 The Clock Tavern 22]]\n- ![[Other.mp3]]\n";
	const choices = choicesFor(text, [["The Silver Spear", "The Silver Spear", candidate("silver spear, the", "182")]]);
	const out = insertChoices(text, choices).text.split("\n");
	assert.equal(out[2], "\t- Identified tune: [[The Silver Spear]], Reel, D ([thesession](https://thesession.org/tunes/182#setting1820))");
	assert.equal(out[3], "- ![[Other.mp3]]");
	// Again: replaced, not repeated.
	const again = insertChoices(out.join("\n"), choices).text;
	assert.equal(again, out.join("\n"));
});

test("choices for recordings no longer in the note are reported", () => {
	const choices = choicesFor(ANDERSONS, [["Anderson's", null, candidate("anderson's", "9")]]);
	const { text, missing } = insertChoices("No audio here now.\n", choices);
	assert.equal(text, "No audio here now.\n");
	assert.deepEqual(missing, ["anderson's.m4a#0"]);
});

test("a list of your own right after the block is kept on a second run", () => {
	const text = ["![[Set.m4a]]", "```loops", "0:00 - 1:00 | Tune 1", "```", "- my own note", "- another"].join("\n");
	const pick = (t: string) => choicesFor(t, [["X", null, candidate("x", "5")]]);
	const once = insertChoices(text, pick(text)).text;
	assert.equal(once.split("\n")[6], "");
	const twice = insertChoices(once, pick(once)).text;
	assert.equal(twice, once);
	assert.ok(twice.endsWith("- my own note\n- another"));
});

test("Windows line endings are kept", () => {
	const text = "---\r\ntype: Reel\r\n---\r\n![[x.mp3]]\r\n\r\nText\r\n";
	const out = insertChoices(text, choicesFor(text, [["X", null, candidate("x", "5")]])).text;
	assert.equal(out, "---\r\ntype: Reel\r\n---\r\n![[x.mp3]]\r\nIdentified tune: X, Reel, D ([thesession](https://thesession.org/tunes/5#setting50))\r\n\r\nText\r\n");
});

const SESSION_SET = [
	"## Set 1",
	"![[Sessions/20260926 The Clock Tavern 22/02 Set 1.m4a]]",
	"```loops",
	"file: Sessions/20260926 The Clock Tavern 22/02 Set 1.m4a",
	"0:00 - 1:51.5 | Tune 1",
	"1:51.5 - 5:04.5 | Tune 2",
	"5:04.5 - 6:56.5 | Tune 3 ?",
	"```",
	"",
	"tunes:: ",
].join("\n");

test("naming loops replaces placeholder labels and keeps the times exactly as written", () => {
	const choices = choicesFor(SESSION_SET, [
		["The Tap Room", "The Tap Room", candidate("tap room, the", "71", "reel", "Edorian")],
		["Good Morning to Your Nightcap", null, candidate("good morning to your nightcap", "72", "reel", "Adorian")],
		["The Glenduan", null, candidate("glenduan, the", "73", "polka")],
	]);
	const out = insertChoices(SESSION_SET, choices, { nameLoops: true, addList: false });
	assert.equal(out.named, 3);
	assert.equal(out.listed, 0);
	assert.equal(
		out.text,
		SESSION_SET.replace("0:00 - 1:51.5 | Tune 1", "0:00 - 1:51.5 | The Tap Room")
			.replace("1:51.5 - 5:04.5 | Tune 2", "1:51.5 - 5:04.5 | Good Morning to Your Nightcap")
			.replace("5:04.5 - 6:56.5 | Tune 3 ?", "5:04.5 - 6:56.5 | The Glenduan")
	);
});

test("sections someone already named are never renamed, but still listed with their label", () => {
	const text = SESSION_SET.replace("| Tune 2", "| Killavil Reel");
	const choices = choicesFor(text, [
		["The Tap Room", null, candidate("tap room, the", "71")],
		["Mick Finn's", null, candidate("mick finn's", "1723")],
	]);
	const out = insertChoices(text, choices, { nameLoops: true, addList: true });
	assert.equal(out.named, 1);
	const lines = out.text.split("\n");
	assert.equal(lines[4], "0:00 - 1:51.5 | The Tap Room");
	assert.equal(lines[5], "1:51.5 - 5:04.5 | Killavil Reel");
	assert.equal(lines[8], "Identified tunes:");
	assert.equal(lines[9], "- 0:00 - 1:51.5: The Tap Room, Reel, D ([thesession](https://thesession.org/tunes/71#setting710))");
	assert.equal(lines[10], "- 1:51.5 - 5:04.5 (Killavil Reel): Mick Finn's, Reel, D ([thesession](https://thesession.org/tunes/1723#setting17230))");
	assert.equal(lines[11], "");
	assert.equal(lines[12], "tunes:: ");
	// A second run renames nothing more and leaves one list.
	const again = insertChoices(out.text, choicesFor(out.text, [["The Tap Room", null, candidate("tap room, the", "71")], ["Mick Finn's", null, candidate("mick finn's", "1723")]]), { nameLoops: true, addList: true });
	assert.equal(again.named, 0);
	assert.equal(again.text, out.text);
});

test("a section line without a label gets one, and | in a tune name can't break the line", () => {
	const text = ["![[Set.m4a]]", "```loops", "0:00 - 1:00", "1:00 - 2:00 |", "```"].join("\n");
	const out = insertChoices(text, choicesFor(text, [["A | B", null, candidate("a", "1")], ["C", null, candidate("c", "2")]]), { nameLoops: true, addList: false });
	assert.deepEqual(out.text.split("\n").slice(2, 4), ["0:00 - 1:00 | A / B", "1:00 - 2:00 | C"]);
});

test("a scanned recording gets a new loops block under its embed, then the list", () => {
	const text = "![[Sound files/Ballina reels.m4a]]\nIdentified tune: Old, Reel, D ([thesession](https://thesession.org/tunes/9#setting90))\n\nNotes\n";
	const anchor = "ballina reels.m4a#0";
	const detected = new Map<string, DetectedSections>([[anchor, { file: "Sound files/Ballina reels.m4a", sections: [{ start: 0, end: 138 }, { start: 138, end: 274.3 }] }]]);
	const seg = (section: number, start: number, end: number) => ({ anchorKey: anchor, link: "Sound files/Ballina reels.m4a", start, end, label: "", rangeText: `${start === 0 ? "0:00" : "2:18"} - ${end === 138 ? "2:18" : "4:34.3"}`, section });
	// Only the second tune was picked.
	const choices: Choice[] = [{ segment: seg(2, 138, 274.3), candidate: candidate("silver spear, the", "182"), title: "The Silver Spear", note: "The Silver Spear" }];
	const out = insertChoices(text, choices, { nameLoops: true, addList: true, detected });
	assert.equal(out.blocks, 1);
	assert.equal(out.named, 1);
	assert.equal(
		out.text,
		[
			"![[Sound files/Ballina reels.m4a]]",
			"```loops",
			"file: Sound files/Ballina reels.m4a",
			"0:00 - 2:18 | Tune 1",
			"2:18 - 4:34.3 | The Silver Spear",
			"```",
			"Identified tunes:",
			"- 2:18 - 4:34.3: [[The Silver Spear]], Reel, D ([thesession](https://thesession.org/tunes/182#setting1820))",
			"",
			"Notes",
			"",
		].join("\n")
	);
	// Run again: the recording now has a block, so its sections are used and no second block appears.
	const anchors = findAnchors(out.text);
	assert.equal(anchors.length, 1);
	assert.ok(anchors[0].loops);
	assert.equal(segmentsFor(anchors[0]).length, 2);
});

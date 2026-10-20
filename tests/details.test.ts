import { test } from "node:test";
import assert from "node:assert/strict";
import { heardTune, isEmptyValue, ownTuneSegment, sameFamily, suggestDetails, typeInName, usualDetails } from "../src/details.ts";
import type { TuneInfo } from "../src/engine-protocol.ts";
import type { Candidate } from "../src/format.ts";

function tune(id: string, name: string, settings: [string, string][], matchedBy: TuneInfo["matchedBy"] = "name"): TuneInfo {
	return { tune_id: id, name, aliases: [name], settings: settings.map(([dance, mode], i) => ({ setting_id: `${id}${i}`, dance, meter: "", mode })), matchedBy };
}

function candidate(id: string, name: string, dance: string, mode: string, aliases = [name]): Candidate {
	return { setting_id: `${id}0`, tune_id: id, name, score: 0.6, dance, meter: "", mode, aliases };
}

const both = { type: true, key: true };

test("empty values", () => {
	for (const v of [undefined, null, "", "  ", []]) assert.ok(isEmptyValue(v));
	for (const v of ["Reel", 0, ["x"]]) assert.ok(!isEmptyValue(v));
});

test("a tune's usual type and key are the most common across its settings", () => {
	const t = tune("182", "silver spear, the", [["reel", "Dmajor"], ["reel", "Amajor"], ["reel", "Dmajor"]]);
	assert.deepEqual(usualDetails(t), { type: "Reel", key: "D" });
});

test("tune types in names, and which types are easily confused", () => {
	assert.equal(typeInName("Cathedral Jig"), "Jig");
	assert.equal(typeInName("The Kid on the Mountain Slip Jig"), "Slip Jig");
	assert.equal(typeInName("Polca Ui Shuilleabhain"), "Polka");
	assert.equal(typeInName("Leslie's March"), "March");
	assert.equal(typeInName("The Reeling Fool"), null);
	assert.ok(sameFamily("March", "Jig"));
	assert.ok(sameFamily("Single Reel", "Reel"));
	assert.ok(!sameFamily("Reel", "Jig"));
	assert.ok(!sameFamily("Waltz", "Reel"));
});

test("the recording, when it matches the note's name, gives the key it is played in", () => {
	const byName = [tune("182", "silver spear, the", [["reel", "Dmajor"]])];
	const heard = { candidate: candidate("182", "silver spear, the", "reel", "Emajor"), detune: 0 };
	const { suggestion } = suggestDetails(both, byName, heard, "The Silver Spear");
	assert.deepEqual(suggestion, { type: "Reel", key: "E", source: "Matched your recording", confident: true, tuneId: "182" });
});

test("an off-pitch recording confirms the tune but takes the usual key", () => {
	const byName = [tune("182", "silver spear, the", [["reel", "Dmajor"], ["reel", "Dmajor"]])];
	const heard = { candidate: candidate("182", "silver spear, the", "reel", "Emajor"), detune: -1 };
	const { suggestion } = suggestDetails({ type: false, key: true }, byName, heard, "The Silver Spear");
	assert.equal(suggestion?.type, null);
	assert.equal(suggestion?.key, "D");
	assert.match(suggestion!.source, /concert pitch/);
});

test("the type in the note's name wins, and a contradicting match gives no key", () => {
	// "Killavil Reel" whose recording matched a jig with a similar name.
	const heard = { candidate: candidate("576", "killavil fancy, the", "jig", "Edorian", ["killavil fancy, the", "killavil"]), detune: 0 };
	const fromRecording = suggestDetails(both, [], heard, "Killavil Reel").suggestion;
	assert.equal(fromRecording?.type, "Reel");
	assert.equal(fromRecording?.key, null);

	// A 6/8 march filed as a jig on thesession is fine.
	const march = suggestDetails(both, [], { candidate: candidate("1", "leslie's march", "jig", "Dmajor"), detune: 0 }, "Leslie's March").suggestion;
	assert.deepEqual([march?.type, march?.key], ["March", "D"]);

	// "Cathedral Jig" whose name only matches a march.
	const byName = suggestDetails(both, [tune("9", "cathedral, the", [["march", "Gmajor"]])], null, "Cathedral Jig").suggestion;
	assert.deepEqual([byName?.type, byName?.key], ["Jig", null]);

	// No match at all, but the name says what it is.
	const nameOnly = suggestDetails(both, [], null, "Jim Doyle's Polka").suggestion;
	assert.deepEqual([nameOnly?.type, nameOnly?.key, nameOnly?.source], ["Polka", null, "From its name"]);
});

test("without a recording: a unique name gives its usual details, a shared name only an agreed type", () => {
	const one = suggestDetails(both, [tune("1", "kesh, the", [["jig", "Gmajor"]])], null, "The Kesh");
	assert.deepEqual(one.suggestion, { type: "Jig", key: "G", source: "By name on thesession.org", confident: true, tuneId: "1" });

	const shared = suggestDetails(both, [tune("1", "micho russell's", [["reel", "Dmajor"]]), tune("2", "micho russell's", [["reel", "Gmajor"]])], null, "Micho Russell's");
	assert.equal(shared.suggestion?.type, "Reel");
	assert.equal(shared.suggestion?.key, null);
	assert.equal(shared.suggestion?.confident, false);

	const differ = suggestDetails({ type: true, key: false }, [tune("1", "x", [["reel", "Dmajor"]]), tune("2", "x", [["jig", "Dmajor"]])], null, "X");
	assert.equal(differ.suggestion, null);
	assert.match(differ.reason, /differ/);

	assert.equal(suggestDetails(both, [], null, "Bag of Turf").suggestion, null);
	assert.equal(suggestDetails({ type: false, key: false }, [tune("1", "x", [["reel", "Dmajor"]])], null, "X").suggestion, null);
});

test("a close spelling is suggested but left unticked", () => {
	const t = tune("5", "road to lisdoonvarna, the", [["slide", "Eminor"]], "spelling");
	const { suggestion } = suggestDetails(both, [t], null, "Road to Lisdoonvara");
	assert.deepEqual([suggestion?.type, suggestion?.key, suggestion?.confident], ["Slide", "E min", false]);
	assert.match(suggestion!.source, /close spelling/);
});

test("heardTune finds the note's tune among the first few matches by any of its names", () => {
	const cands = [candidate("9", "tap room, the", "reel", "Edorian"), candidate("865", "kevin mchugh's", "jig", "Dmajor", ["kevin mchugh's", "adam and eve"])];
	assert.equal(heardTune(cands, ["Adam and Eve's"])?.tune_id, "865");
	assert.equal(heardTune(cands, ["The Silver Spear"]), null);
});

test("ownTuneSegment: select: line, then a section labelled with the note's name, then a plain recording", () => {
	const withSelect = ["![[Set 6.m4a]]", "```loops", "select: 2", "0:00 - 1:46 | A", "1:46 - 5:29 | B", "```"].join("\n");
	assert.equal(ownTuneSegment(withSelect, ["Anything"])?.label, "B");

	const labelled = ["![[Set 6.m4a]]", "```loops", "0:00 - 1:46 | Green Fields of Rossbeigh", "1:46 - 5:29 | Killavil Reel", "```"].join("\n");
	assert.equal(ownTuneSegment(labelled, ["The Killavil Reel"])?.start, 106);
	assert.equal(ownTuneSegment(labelled, ["Something Else"]), null);

	assert.equal(ownTuneSegment("![[Anderson's.m4a]]\n", ["Anderson's"])?.rangeText, "");
	assert.equal(ownTuneSegment("No audio\n", ["x"]), null);
});

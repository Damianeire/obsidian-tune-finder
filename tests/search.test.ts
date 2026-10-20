import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTOUR_CHARS, confidence, medianPitch, octaveCorrection, searchWithCorrection, transpose } from "../src/search.ts";
import { VaultTunes } from "../src/vault-match.ts";

const at = (midi: number) => CONTOUR_CHARS[midi - 48];

test("transpose moves notes and folds the ends back into range", () => {
	assert.equal(transpose(at(62) + at(64), 2), at(64) + at(66));
	assert.equal(transpose(at(49), -3), at(58));
	assert.equal(transpose(at(94), 5), at(87));
});

test("octaveCorrection brings a low (banjo) transcription up to the index's octave", () => {
	const banjo = [50, 52, 54, 55, 57, 59, 57, 55].map(at).join("");
	assert.equal(medianPitch(banjo), 55);
	assert.equal(octaveCorrection(banjo), 12);
	const fiddle = [62, 66, 69, 71, 74, 76, 74, 71].map(at).join("");
	assert.equal(octaveCorrection(fiddle), 0);
});

test("confidence tiers", () => {
	assert.equal(confidence([{ score: 0.7 }, { score: 0.3 }]), "likely");
	assert.equal(confidence([{ score: 0.45 }, { score: 0.4 }]), "possible");
	assert.equal(confidence([{ score: 0.2 }, { score: 0.1 }]), "unsure");
	assert.equal(confidence([]), "unsure");
});

test("searchWithCorrection keeps a strong untransposed result and only tries others when weak", () => {
	const tune = [62, 64, 66, 67, 69, 71, 69, 67].map(at).join("");
	let calls = 0;
	const strong = searchWithCorrection(tune, () => {
		calls++;
		return [{ score: 0.8 }, { score: 0.2 }];
	});
	assert.equal(calls, 1);
	assert.equal(strong.detune, 0);

	// The tune is in the index a semitone lower than it was played.
	const lower = transpose(tune, -1);
	const found = searchWithCorrection(tune, (c) => (c === lower ? [{ score: 0.7 }, { score: 0.2 }] : [{ score: 0.15 }, { score: 0.1 }]));
	assert.equal(found.detune, -1);
	assert.equal(found.confidence, "likely");
	assert.equal(found.queries, 7);

	// A transposed result that is only slightly better doesn't win.
	const marginal = searchWithCorrection(tune, (c) => (c === lower ? [{ score: 0.32 }, { score: 0.3 }] : [{ score: 0.25 }, { score: 0.2 }]));
	assert.equal(marginal.detune, 0);
});

test("VaultTunes finds notes by any name of the tune, and by close spelling only when unambiguous", () => {
	const tunes = new VaultTunes([
		{ basename: "Adam and Eve's", aliases: [] },
		{ basename: "The Blackberry Blossom", aliases: [] },
		{ basename: "Ballydesmond No. 1", aliases: [] },
		{ basename: "Ballydesmond No. 2", aliases: [] },
		{ basename: "Nora Crionna", aliases: ["Nóra Chríonna"] },
	]);
	assert.equal(tunes.find(["kevin mchugh's", "adam and eve"])?.basename, "Adam and Eve's");
	assert.equal(tunes.find(["blackberry blossum"])?.basename, "The Blackberry Blossom");
	assert.equal(tunes.find(["ballydesmond polka no. 2"])?.basename, "Ballydesmond No. 2");
	assert.equal(tunes.find(["nora chriona"])?.basename, "Nora Crionna");
	assert.equal(tunes.find(["the kesh"]), null);
});

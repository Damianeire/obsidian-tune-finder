// Identify every loop section in a note, the way the plugin does, and print
// the candidates: `node eval/session.mjs <note.md> <vault root>`
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEngine, decodeAudio, identify } from "./engine.mjs";
import { findAnchors, segmentsFor, retryWindows } from "../src/note-scan.ts";
import { isBetterMatch, matchesNothing } from "../src/search.ts";
import { displayName } from "../src/names.ts";
import { formatDance, formatKey } from "../src/format.ts";

const [note, vault, seconds = "60"] = process.argv.slice(2);
const { engine } = await loadEngine();
for (const anchor of findAnchors(readFileSync(note, "utf8"))) {
	const file = join(vault, anchor.link);
	console.log(`\n${anchor.link}`);
	for (const seg of segmentsFor(anchor)) {
		const length = Math.min(Number(seconds), (seg.end ?? seg.start + 600) - seg.start);
		const pcm = await decodeAudio(file, seg.start, length);
		let r = identify(engine, pcm, 5);
		let from = "";
		const again = !r.error && r.confidence === "unsure" && seg.end != null ? retryWindows(seg, seg.end, Number(seconds)) : [];
		const top = (x) => x.results[0]?.score ?? 0;
		for (const win of again) {
			const later = identify(engine, await decodeAudio(file, win.start, win.end - win.start), 5);
			if (!later.error && isBetterMatch({ confidence: later.confidence, top: top(later) }, { confidence: r.confidence, top: top(r) })) {
				r = later;
				from = `, from ${win.start}s`;
			}
		}
		if (r.error) {
			console.log(`  ${seg.rangeText} | ${seg.label}: ${r.error}`);
			continue;
		}
		const shift = r.detune ? `, matched ${r.detune > 0 ? "+" : ""}${r.detune}` : "";
		console.log(`  ${seg.rangeText} | ${seg.label}: ${matchesNothing(r.results) ? "no match" : r.confidence}${shift}${from}`);
		for (const c of r.results.slice(0, 3)) console.log(`      ${c.score.toFixed(2)}  #${c.tune_id} ${displayName(c.name)} (${formatDance(c.dance)}, ${formatKey(c.mode)})`);
	}
}

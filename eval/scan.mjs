// How well does scanning a whole recording find its tune changes?
//
//   node eval/scan.mjs "<vault>"
//
// Uses every loops block in the vault with two or more sections as the
// reference: its boundaries (from trad-split or corrected by hand), and its
// names where sections are named, or where the file name lists the tunes.
// Each recording is scanned once (window results are cached in eval/cache),
// then the smoothing settings are compared. Recordings are only read.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeAudio, identify, loadEngine, SAMPLE_RATE } from "./engine.mjs";
import { isPlaceholderLabel } from "../src/loops.ts";
import { namesMatch } from "../src/names.ts";
import { findAnchors } from "../src/note-scan.ts";
import { DEFAULT_SCAN, scanRecording, scanWindows, sectionsFromPath, smoothWindows } from "../src/scan.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vault = process.argv[2];
const TOLERANCE = 15;

function walk(dir) {
	return readdirSync(dir).flatMap((f) => {
		if (f.startsWith(".")) return [];
		const p = join(dir, f);
		return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
	});
}

/** Tune names listed in a file name such as "Artist - A ⧸ B ⧸ C (Reels).mp3", in order. */
function namesFromFile(path, count) {
	let s = basename(path).replace(/\.[^.]+$/, "").replace(/\([^)]*\)/g, "").replace(/^\d+\.\s*/, "");
	if (s.includes(" - ")) s = s.slice(s.indexOf(" - ") + 3);
	const parts = s.split(/\s*(?:⧸|\/|,|\+|\s{2,})\s*/).map((p) => p.trim()).filter(Boolean);
	return parts.length === count ? parts : null;
}

function references() {
	const seen = new Set();
	const refs = [];
	for (const note of walk(vault)) {
		const text = readFileSync(note, "utf8");
		if (!text.includes("```loops")) continue;
		for (const a of findAnchors(text)) {
			const sections = a.loops?.block.sections ?? [];
			if (sections.length < 2) continue;
			const file = join(vault, a.link);
			if (!existsSync(file) || seen.has(file)) continue;
			seen.add(file);
			const fromFile = namesFromFile(file, sections.length);
			refs.push({
				note: relative(vault, note),
				file,
				sections: sections.map((s, i) => ({
					start: s.start,
					end: s.end,
					name: !isPlaceholderLabel(s.name) ? s.name : fromFile ? fromFile[i] : null,
				})),
			});
		}
	}
	return refs;
}

async function windowResults(engine, aliases, ref, opts) {
	mkdirSync(join(here, "cache", "scan"), { recursive: true });
	// Keyed on the path within the vault: session folders reuse names like "02 Set 1.m4a".
	const key = relative(vault, ref.file).replace(/[\/]/g, "__");
	const cachePath = join(here, "cache", "scan", `${key}.${opts.windowSeconds}-${opts.hopSeconds}.json`);
	if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, "utf8"));
	const pcm = await decodeAudio(ref.file);
	const duration = pcm.length / SAMPLE_RATE;
	const t0 = performance.now();
	let queries = 0;
	const { windows } = await scanRecording(
		duration,
		(start, end) => pcm.subarray(Math.floor(start * SAMPLE_RATE), Math.floor(end * SAMPLE_RATE)),
		async (slice, hint, explore) => {
			const r = identify(engine, slice, 10, true, hint, explore);
			if (r.error) throw new Error(r.error);
			queries += r.queries;
			return { candidates: r.results.map((c) => ({ tune_id: c.tune_id, score: c.score })), shift: r.shift, likely: r.confidence === "likely" };
		},
		undefined,
		undefined,
		opts
	);
	// Per-section identification, as the plugin does for loops: the reference to beat.
	const perSection = ref.sections.map((s) => {
		const end = Math.min(s.end ?? duration, s.start + 60);
		const r = identify(engine, pcm.subarray(Math.floor(s.start * SAMPLE_RATE), Math.floor(end * SAMPLE_RATE)), 10);
		return r.results[0]?.tune_id ?? null;
	});
	const out = { duration, windows, perSection, seconds: (performance.now() - t0) / 1000, queries };
	writeFileSync(cachePath, JSON.stringify(out));
	return out;
}

function compare(ref, found, aliases) {
	const refBounds = ref.sections.slice(1).map((s) => s.start);
	const foundBounds = found.slice(1).map((s) => s.start);
	const matched = refBounds.filter((b) => foundBounds.some((f) => Math.abs(f - b) <= TOLERANCE)).length;
	const correct = foundBounds.filter((f) => refBounds.some((b) => Math.abs(f - b) <= TOLERANCE)).length;
	const errors = refBounds.map((b) => Math.min(...foundBounds.map((f) => Math.abs(f - b)), Infinity)).filter((e) => e <= TOLERANCE);
	let named = 0;
	let nameRight = 0;
	for (const s of ref.sections) {
		if (!s.name) continue;
		named++;
		const mid = (s.start + (s.end ?? s.start + 60)) / 2;
		const hit = found.find((f) => f.start <= mid && mid < f.end);
		if (hit?.tuneId && (aliases[hit.tuneId] ?? []).some((n) => namesMatch(n, s.name, { allowContains: true }))) nameRight++;
	}
	return { refBounds: refBounds.length, foundBounds: foundBounds.length, matched, correct, errors, named, nameRight };
}

const { engine, aliases } = await loadEngine();
const refs = references();
console.log(`${refs.length} recordings with loops; ${refs.reduce((n, r) => n + r.sections.filter((s) => s.name).length, 0)} named sections\n`);

const configs = [];
for (const switchPenalty of [0.3, 0.5, 0.8, 1.2]) {
	for (const minSectionSeconds of [30, 45]) {
		for (const unknownScore of [0.15, 0.2]) configs.push({ ...DEFAULT_SCAN, switchPenalty, minSectionSeconds, unknownScore });
	}
}

const data = [];
for (const ref of refs) {
	process.stderr.write(`scanning ${basename(ref.file)}\n`);
	data.push({ ref, ...(await windowResults(engine, aliases, ref, DEFAULT_SCAN)) });
}

let perSectionNamed = 0;
let perSectionRight = 0;
for (const d of data) {
	d.ref.sections.forEach((s, i) => {
		if (!s.name) return;
		perSectionNamed++;
		const id = d.perSection[i];
		if (id && (aliases[id] ?? []).some((n) => namesMatch(n, s.name, { allowContains: true }))) perSectionRight++;
	});
}

console.log("penalty min unknown | boundaries found (recall) | found that are real (precision) | mean error | names right");
const summaries = configs.map((opts) => {
	const totals = { refBounds: 0, foundBounds: 0, matched: 0, correct: 0, errors: [], named: 0, nameRight: 0 };
	for (const d of data) {
		const times = scanWindows(d.duration, opts);
		const found = sectionsFromPath(times, smoothWindows(d.windows, opts), d.duration, opts);
		const c = compare(d.ref, found, aliases);
		for (const k of ["refBounds", "foundBounds", "matched", "correct", "named", "nameRight"]) totals[k] += c[k];
		totals.errors.push(...c.errors);
	}
	const mean = totals.errors.length ? totals.errors.reduce((a, b) => a + b, 0) / totals.errors.length : NaN;
	console.log(
		`${String(opts.switchPenalty).padStart(7)} ${String(opts.minSectionSeconds).padStart(3)} ${String(opts.unknownScore).padStart(7)} | ` +
			`${totals.matched}/${totals.refBounds}`.padStart(26) + " | " + `${totals.correct}/${totals.foundBounds}`.padStart(32) +
			` | ${mean.toFixed(1).padStart(8)}s | ${totals.nameRight}/${totals.named}`
	);
	return { opts, totals };
});
console.log(`\nNames right identifying each reference section on its own (as for loops): ${perSectionRight}/${perSectionNamed}`);
const time = data.reduce((a, d) => a + d.seconds, 0);
const audio = data.reduce((a, d) => a + d.duration, 0);
console.log(`Scanning took ${time.toFixed(0)} s for ${(audio / 60).toFixed(0)} min of audio (${data.reduce((a, d) => a + d.queries, 0)} searches)`);

// Detail for the default settings.
console.log("\nWith the default settings:");
for (const d of data) {
	const times = scanWindows(d.duration, DEFAULT_SCAN);
	const found = sectionsFromPath(times, smoothWindows(d.windows, DEFAULT_SCAN), d.duration, DEFAULT_SCAN);
	const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
	console.log(`\n${relative(vault, d.ref.file)}`);
	console.log(`  reference: ${d.ref.sections.map((s) => `${fmt(s.start)} ${s.name ?? "?"}`).join(" | ")}`);
	console.log(`  found:     ${found.map((f) => `${fmt(f.start)} ${f.tuneId ? (aliases[f.tuneId]?.[0] ?? f.tuneId) : "?"}`).join(" | ")}`);
}

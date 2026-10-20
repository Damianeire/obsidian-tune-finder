// Node helpers for running the Tune Finder engine outside Obsidian:
// load the WASM build and the FolkFriend tune index, decode audio with
// ffmpeg, transcribe and search.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { confidence, searchWithCorrection } from "../src/search.ts";
import { INDEX_URL } from "../src/engine-protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..", "engine", "pkg");
const cacheDir = join(here, "cache");

export const SAMPLE_RATE = 48000;

export async function loadIndexJson() {
	const path = join(cacheDir, "folkfriend-non-user-data.json");
	if (!existsSync(path)) {
		mkdirSync(cacheDir, { recursive: true });
		console.error(`Downloading tune index from ${INDEX_URL} ...`);
		const res = await fetch(INDEX_URL);
		if (!res.ok) throw new Error(`Index download failed: ${res.status}`);
		writeFileSync(path, Buffer.from(await res.arrayBuffer()));
	}
	return JSON.parse(readFileSync(path, "utf8"));
}

export async function loadEngine() {
	const wasm = await import(join(pkgDir, "tune_finder_engine.js"));
	wasm.initSync({ module: readFileSync(join(pkgDir, "tune_finder_engine_bg.wasm")) });
	const index = await loadIndexJson();
	// As in FolkFriend's app, the ABC strings stay out of the engine.
	for (const s of Object.values(index.settings)) s.abc = "";
	const engine = new wasm.Engine();
	const t0 = performance.now();
	const count = engine.load_index(JSON.stringify(index));
	const loadMs = performance.now() - t0;
	return { engine, aliases: index.aliases, count, loadMs };
}

/** Decode `durationSec` seconds of audio from `startSec` to 48 kHz mono f32. */
export function decodeAudio(file, startSec = 0, durationSec = null) {
	const args = ["-v", "error", "-ss", String(startSec)];
	if (durationSec != null) args.push("-t", String(durationSec));
	args.push("-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-");
	return new Promise((resolve, reject) => {
		const p = spawn("ffmpeg", args);
		const chunks = [];
		let err = "";
		p.stdout.on("data", (c) => chunks.push(c));
		p.stderr.on("data", (c) => (err += c));
		p.on("close", (code) => {
			if (code !== 0) return reject(new Error(`ffmpeg failed (${code}): ${err.trim()}`));
			const buf = Buffer.concat(chunks);
			resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
		});
	});
}

/**
 * Transcribe and search. With `corrected` (what the plugin does) the search
 * includes octave and transposition correction; without it, it is
 * FolkFriend's plain query.
 */
export function identify(engine, pcm, n = 10, corrected = true, hint = null, explore = true) {
	const t0 = performance.now();
	let contour;
	try {
		contour = engine.transcribe(pcm, SAMPLE_RATE);
	} catch (e) {
		return { error: String(e.message ?? e), results: [], transcribeMs: performance.now() - t0, queryMs: 0 };
	}
	const t1 = performance.now();
	const query = (c) => JSON.parse(engine.query(c, n));
	const outcome = corrected
		? searchWithCorrection(contour, query, hint, explore)
		: { results: query(contour), shift: 0, detune: 0, queries: 1 };
	const t2 = performance.now();
	return { contour, ...outcome, confidence: confidence(outcome.results), transcribeMs: t1 - t0, queryMs: t2 - t1 };
}

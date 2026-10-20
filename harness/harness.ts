// Browser harness: runs the plugin's engine client, worker, WebAssembly,
// IndexedDB cache and Web Audio decoding outside Obsidian, on recordings in
// harness/audio/. Build with `node harness/build.mjs`, serve the project
// root, and open /harness/.
import { EngineClient } from "../src/engine-client.ts";
import { SAMPLE_RATE, monoSlice } from "../src/audio.ts";
import { displayName } from "../src/names.ts";
import { scanRecording } from "../src/scan.ts";

const out = document.getElementById("out")!;
const statusEl = document.getElementById("status")!;

function log(line: string): void {
	out.textContent += line + "\n";
}

async function decode(url: string): Promise<AudioBuffer> {
	const data = await (await fetch(url)).arrayBuffer();
	return new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(data);
}

async function run(): Promise<void> {
	const params = new URLSearchParams(location.search);
	const files = (params.get("files") ?? "").split(",").filter(Boolean);
	const seconds = Number(params.get("seconds") ?? 60);
	const engine = new EngineClient();

	const t0 = performance.now();
	const info = await engine.ensureIndex({ status: (t) => (statusEl.textContent = t) });
	log(`index: ${info.settings} settings, version ${info.version}, saved ${new Date(info.savedAt).toISOString()}, ready in ${Math.round(performance.now() - t0)} ms`);

	for (const file of files) {
		const t1 = performance.now();
		const buffer = await decode(`audio/${encodeURIComponent(file)}`);
		const pcm = monoSlice(buffer, 0, Math.min(buffer.duration, seconds));
		const t2 = performance.now();
		const result = await engine.identify(pcm, SAMPLE_RATE, 10);
		const t3 = performance.now();
		log(`\n${file}: ${buffer.duration.toFixed(1)} s, ${buffer.numberOfChannels} ch; decode ${Math.round(t2 - t1)} ms, identify ${Math.round(t3 - t2)} ms`);
		log(`  confidence ${result.confidence}, detune ${result.detune}, octaves ${result.octaves}, ${result.notes} quavers`);
		for (const c of result.candidates.slice(0, 3)) {
			log(`  ${c.score.toFixed(2)}  ${displayName(c.name)}  (${c.dance}, ${c.mode}, tune ${c.tune_id})`);
		}
	}
	const names = params.get("names");
	if (names) {
		for (const name of names.split(",")) {
			const tunes = await engine.lookupNames([name]);
			log(`\nnames "${name}": ${tunes.map((t) => `${displayName(t.name)} [${t.matchedBy}] ${t.settings.length} settings, first ${t.settings[0]?.dance} ${t.settings[0]?.mode}`).join("; ") || "none"}`);
		}
	}
	const scanFile = params.get("scan");
	if (scanFile) {
		const buffer = await decode(`audio/${encodeURIComponent(scanFile)}`);
		const t4 = performance.now();
		let searches = 0;
		const { sections } = await scanRecording(
			buffer.duration,
			(start, end) => monoSlice(buffer, start, end),
			async (pcm, hint, explore) => {
				const r = await engine.identify(pcm, SAMPLE_RATE, 10, hint, explore);
				searches++;
				return { candidates: r.candidates, shift: r.shift, likely: r.confidence === "likely" };
			},
			(done, total) => (statusEl.textContent = `scanning ${done}/${total}`)
		);
		log(`\nscan of ${scanFile} (${buffer.duration.toFixed(0)} s): ${Math.round(performance.now() - t4)} ms, ${searches} windows`);
		for (const s of sections) log(`  ${s.start.toFixed(1)} - ${s.end.toFixed(1)}  tune ${s.tuneId ?? "?"}`);
	}
	statusEl.textContent = "done";
	(window as unknown as { harnessDone: boolean }).harnessDone = true;
}

run().catch((e) => {
	statusEl.textContent = `error: ${(e as Error).message}`;
	log(String((e as Error).stack ?? e));
});

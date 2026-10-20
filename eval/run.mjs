// Accuracy check for Tune Finder against a folder of labelled recordings.
//
//   node eval/run.mjs --dir "<vault>/Sound files" --notes "<vault>/Trad Tunes" \
//     [--durations 15,30,45,60,0] [--skip 0] [--workers 3] [--limit 0]
//
// For each recording and each duration (seconds analysed from the start,
// 0 = whole file, capped at 5 minutes) it records the rank at which the
// right tune appears. Recordings are only read, never copied or changed.
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { namesMatch, displayName } from "../src/names.ts";
import { labelsFromFilename, embedTitles } from "./labels.mjs";
import { loadEngine, loadIndexJson, decodeAudio, identify, SAMPLE_RATE } from "./engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const AUDIO = /\.(mp3|m4a|wav|ogg|flac)$/i;
const WHOLE_CAP_SEC = 300;

function parseArgs(argv) {
	const a = { durations: "15,30,45,60,0", skip: "0", workers: "3", limit: "0", plain: "no" };
	for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, "")] = argv[i + 1];
	return {
		dir: a.dir,
		notes: a.notes,
		durations: a.durations.split(",").map(Number),
		skip: Number(a.skip),
		workers: Number(a.workers),
		limit: Number(a.limit),
		plain: a.plain === "yes",
		out: a.out ?? join(here, "out"),
	};
}

async function workerMain() {
	const { engine } = await loadEngine();
	parentPort.postMessage({ ready: true });
	parentPort.on("message", async ({ file, durations, skip, plain }) => {
		const t0 = performance.now();
		let pcm;
		try {
			pcm = await decodeAudio(file, skip, WHOLE_CAP_SEC);
		} catch (e) {
			parentPort.postMessage({ file, error: String(e.message ?? e) });
			return;
		}
		const decodeMs = performance.now() - t0;
		const runs = durations.map((d) => {
			const slice = d > 0 ? pcm.subarray(0, Math.min(pcm.length, d * SAMPLE_RATE)) : pcm;
			const r = identify(engine, slice, 10, !plain);
			return {
				duration: d,
				seconds: slice.length / SAMPLE_RATE,
				error: r.error,
				contourLength: r.contour?.length ?? 0,
				results: r.results.map((x) => ({ tune_id: x.tune_id, name: x.name, score: x.score, dance: x.dance })),
				shift: r.shift ?? 0,
				detune: r.detune ?? 0,
				queries: r.queries ?? 0,
				confidence: r.confidence ?? "",
				transcribeMs: r.transcribeMs,
				queryMs: r.queryMs,
			};
		});
		parentPort.postMessage({ file, decodeMs, audioSeconds: pcm.length / SAMPLE_RATE, runs });
	});
}

function rankOf(results, labels, aliases) {
	for (let i = 0; i < results.length; i++) {
		const names = aliases[results[i].tune_id] ?? [results[i].name];
		if (names.some((n) => labels.some((l) => namesMatch(n, l, { allowContains: true })))) return i + 1;
	}
	return 0;
}

function pct(n, d) {
	return d === 0 ? "-" : `${((100 * n) / d).toFixed(0)}%`;
}

function quantiles(xs) {
	if (xs.length === 0) return "-";
	const s = [...xs].sort((a, b) => a - b);
	const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
	return `p10 ${q(0.1)} / median ${q(0.5)} / p90 ${q(0.9)}`;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (!opts.dir || !opts.notes) throw new Error("--dir and --notes are required");
	const { aliases } = await loadIndexJson();
	const embeds = embedTitles(opts.notes);

	let files = readdirSync(opts.dir).filter((f) => AUDIO.test(f)).sort();
	if (opts.limit > 0) files = files.slice(0, opts.limit);
	const overrides = JSON.parse(readFileSync(join(here, "overrides.json"), "utf8"));
	// Patterns naming your own recordings' venues and people stay out of the repo.
	const localPath = join(here, "overrides.local.json");
	if (existsSync(localPath)) {
		const local = JSON.parse(readFileSync(localPath, "utf8"));
		overrides.unlabelled.push(...(local.unlabelled ?? []));
		Object.assign(overrides.alsoKnownAs, local.alsoKnownAs ?? {});
	}
	const unlabelled = overrides.unlabelled.map((p) => new RegExp(p, "i"));
	const jobs = files.map((f) => {
		if (unlabelled.some((re) => re.test(f))) return { file: join(opts.dir, f), name: f, labels: [] };
		const labels = new Set(labelsFromFilename(f));
		for (const t of embeds.get(f) ?? []) labels.add(t);
		for (const [name, extra] of Object.entries(overrides.alsoKnownAs)) {
			if ([...labels].some((l) => namesMatch(l, name, { allowContains: true }))) extra.forEach((x) => labels.add(x));
		}
		return { file: join(opts.dir, f), name: f, labels: [...labels] };
	});
	console.error(`${jobs.length} recordings, ${jobs.filter((j) => j.labels.length).length} labelled; ${opts.workers} workers`);

	const results = [];
	const queue = [...jobs];
	const byFile = new Map(jobs.map((j) => [j.file, j]));
	await new Promise((resolveAll) => {
		let active = 0;
		const started = Date.now();
		for (let w = 0; w < Math.min(opts.workers, jobs.length); w++) {
			const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { worker: true } });
			active++;
			const next = () => {
				const job = queue.shift();
				if (!job) {
					worker.terminate();
					if (--active === 0) resolveAll();
					return;
				}
				worker.postMessage({ file: job.file, durations: opts.durations, skip: opts.skip, plain: opts.plain });
			};
			worker.on("message", (msg) => {
				if (!msg.ready) {
					results.push({ ...byFile.get(msg.file), ...msg });
					const secs = ((Date.now() - started) / 1000).toFixed(0);
					process.stderr.write(`\r${results.length}/${jobs.length} done (${secs}s)   `);
				}
				next();
			});
			worker.on("error", (e) => console.error("\nworker error", e));
		}
	});
	process.stderr.write("\n");

	// Per-file CSV
	mkdirSync(opts.out, { recursive: true });
	const rows = [["file", "labels", "duration", "seconds", "rank", "top1", "top1_score", "top2_score", "contour_len", "shift", "confidence", "queries", "transcribe_ms", "query_ms", "error"]];
	const summary = new Map(opts.durations.map((d) => [d, { n: 0, r1: 0, r3: 0, r10: 0, noNotes: 0, hitScores: [], missScores: [], hitMargins: [], missMargins: [], tMs: [], qMs: [], tiers: {} }]));
	for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
		if (r.error) {
			rows.push([r.name, r.labels.join(" / "), "", "", "", "", "", "", "", "", "", "", "", "", r.error]);
			continue;
		}
		for (const run of r.runs) {
			const rank = r.labels.length ? rankOf(run.results, r.labels, aliases) : "";
			const top = run.results[0];
			rows.push([
				r.name, r.labels.join(" / "), run.duration || "whole", run.seconds.toFixed(1), rank,
				top ? displayName(top.name) : "", top?.score?.toFixed(3) ?? "", run.results[1]?.score?.toFixed(3) ?? "",
				run.contourLength, run.shift, run.confidence, run.queries, run.transcribeMs.toFixed(0), run.queryMs.toFixed(0), run.error ?? "",
			]);
			if (!r.labels.length) continue;
			const s = summary.get(run.duration);
			s.n++;
			s.tMs.push(run.transcribeMs);
			s.qMs.push(run.queryMs);
			if (run.error) { s.noNotes++; continue; }
			const tier = (s.tiers[run.confidence || "none"] ??= { n: 0, right: 0 });
			tier.n++;
			if (rank === 1) tier.right++;
			if (rank === 1) s.r1++;
			if (rank >= 1 && rank <= 3) s.r3++;
			if (rank >= 1) s.r10++;
			const margin = (run.results[0]?.score ?? 0) - (run.results[1]?.score ?? 0);
			(rank === 1 ? s.hitScores : s.missScores).push(run.results[0]?.score ?? 0);
			(rank === 1 ? s.hitMargins : s.missMargins).push(margin);
		}
	}
	const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
	writeFileSync(join(opts.out, "report.csv"), csv);

	console.log(`\nLabelled recordings: ${summary.get(opts.durations[0]).n}`);
	console.log("analysed | top-1 | top-3 | top-10 | no notes | transcribe ms (median) | query ms (median)");
	for (const [d, s] of summary) {
		const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(0) : "-");
		console.log(`${String(d || "whole").padStart(8)} | ${pct(s.r1, s.n).padStart(5)} | ${pct(s.r3, s.n).padStart(5)} | ${pct(s.r10, s.n).padStart(6)} | ${String(s.noNotes).padStart(8)} | ${med(s.tMs).padStart(22)} | ${med(s.qMs).padStart(17)}`);
	}
	console.log("\nTop score when right vs wrong (helps pick a confidence threshold):");
	for (const [d, s] of summary) {
		console.log(`  ${d || "whole"}: right ${quantiles(s.hitScores)}; wrong ${quantiles(s.missScores)}`);
		console.log(`  ${" ".repeat(String(d || "whole").length)}  margin over 2nd: right ${quantiles(s.hitMargins)}; wrong ${quantiles(s.missMargins)}`);
	}
	console.log("\nHow often the top result is right, by the confidence shown:");
	for (const [d, s] of summary) {
		const parts = Object.entries(s.tiers).map(([t, v]) => `${t} ${pct(v.right, v.n)} of ${v.n}`);
		console.log(`  ${d || "whole"}: ${parts.join("; ")}`);
	}
	console.log(`\nPer-file results: ${join(opts.out, "report.csv")}`);
}

if (isMainThread) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
} else if (workerData?.worker) {
	workerMain();
}

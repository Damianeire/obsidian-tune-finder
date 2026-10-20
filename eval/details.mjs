// How good are the type/key suggestions? Runs the same rules as "Fill in
// missing tune types and keys" over tune notes that already have both,
// pretending they are empty, and compares the suggestions with what's
// there. Also lists what it would suggest for the notes that are missing
// them. Read only.
//
//   node eval/details.mjs "<vault>" ["Trad Tunes"]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { decodeAudio, identify, loadEngine, SAMPLE_RATE } from "./engine.mjs";
import { heardTune, ownTuneSegment, suggestDetails } from "../src/details.ts";
import { levenshtein, nameKey } from "../src/names.ts";

const [vault, folder = "Trad Tunes"] = process.argv.slice(2);

function walk(dir) {
	return readdirSync(dir).flatMap((f) => {
		if (f.startsWith(".")) return [];
		const p = join(dir, f);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});
}
const allFiles = walk(vault);
const audioByName = new Map(allFiles.filter((f) => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f)).map((f) => [basename(f).toLowerCase(), f]));

function frontmatterField(text, field) {
	const m = text.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return undefined;
	const line = m[1].match(new RegExp(`^${field}:[ \\t]*(.*)$`, "m"));
	if (!line) return "";
	return line[1].trim().replace(/^["']|["']$/g, "");
}

const { engine, aliases } = await loadEngine();
const nameIndex = new Map();
for (const [id, list] of Object.entries(aliases)) {
	for (const a of list) {
		const k = nameKey(a);
		if (!k) continue;
		const ids = nameIndex.get(k) ?? [];
		if (!ids.includes(id)) ids.push(id);
		nameIndex.set(k, ids);
	}
}
const lookupNames = (names) => {
	const keys = names.map(nameKey).filter((k) => k);
	const ids = new Set(keys.flatMap((k) => nameIndex.get(k) ?? []));
	let matchedBy = "name";
	if (ids.size === 0) {
		matchedBy = "spelling";
		for (const key of keys) {
			if (key.length < 8) continue;
			for (const [other, list] of nameIndex) {
				if (Math.abs(other.length - key.length) > 2 || other[0] !== key[0]) continue;
				if (1 - levenshtein(key, other) / Math.max(key.length, other.length) >= 0.85) list.forEach((id) => ids.add(id));
			}
		}
	}
	return [...ids].map((id) => ({ tune_id: id, name: aliases[id][0], aliases: aliases[id], settings: JSON.parse(engine.tune_settings(id)), matchedBy }));
};

async function listen(text, names) {
	const seg = ownTuneSegment(text, names);
	if (!seg) return null;
	const file = allFiles.includes(join(vault, seg.link)) ? join(vault, seg.link) : audioByName.get(basename(seg.link).toLowerCase());
	if (!file) return null;
	const length = Math.min(60, (seg.end ?? seg.start + 60) - seg.start);
	const pcm = await decodeAudio(file, seg.start, length).catch(() => null);
	if (!pcm || pcm.length < 3 * SAMPLE_RATE) return null;
	const r = identify(engine, pcm, 10);
	if (r.error) return null;
	const candidate = heardTune(r.results.map((c) => ({ ...c, aliases: aliases[c.tune_id] ?? [c.name] })), names);
	return candidate ? { candidate, detune: r.detune } : null;
}

const notes = allFiles.filter((f) => f.startsWith(join(vault, folder) + "/") && f.endsWith(".md"));
const stats = { complete: 0, typeSuggested: 0, typeRight: 0, keySuggested: 0, keyRight: 0, bySource: {} };
const missing = [];
const wrong = [];
for (const [i, note] of notes.entries()) {
	process.stderr.write(`\r${i + 1}/${notes.length}`);
	const text = readFileSync(note, "utf8");
	const type = frontmatterField(text, "type");
	const key = frontmatterField(text, "key");
	if (type === undefined) continue;
	const names = [basename(note, ".md")];
	const byName = lookupNames(names);
	const heard = await listen(text, names);
	if (type && key) {
		// Pretend both are empty and compare.
		stats.complete++;
		const { suggestion } = suggestDetails({ type: true, key: true }, byName, heard, names[0]);
		if (!suggestion) continue;
		const src = suggestion.source.startsWith("Matched")
			? "recording"
			: suggestion.source.startsWith("By name")
				? "name"
				: suggestion.source.startsWith("By a close")
					? "close spelling"
					: suggestion.source.startsWith("From its name")
						? "type in its name"
						: "shared name";
		const s = (stats.bySource[src] ??= { n: 0, type: 0, typeRight: 0, key: 0, keyRight: 0 });
		s.n++;
		if (suggestion.type) {
			stats.typeSuggested++;
			s.type++;
			if (suggestion.type.toLowerCase() === type.toLowerCase()) {
				stats.typeRight++;
				s.typeRight++;
			} else wrong.push(`type  ${basename(note, ".md")}: has ${type}, suggested ${suggestion.type} (${src})`);
		}
		if (suggestion.key) {
			stats.keySuggested++;
			s.key++;
			if (suggestion.key.toLowerCase() === key.toLowerCase()) {
				stats.keyRight++;
				s.keyRight++;
			} else wrong.push(`key   ${basename(note, ".md")}: has ${key}, suggested ${suggestion.key} (${src})`);
		}
	} else {
		const { suggestion, reason } = suggestDetails({ type: !type, key: !key }, byName, heard, names[0]);
		missing.push(`${basename(note, ".md")}: ${suggestion ? `${[suggestion.type && `type ${suggestion.type}`, suggestion.key && `key ${suggestion.key}`].filter(Boolean).join(", ")} [${suggestion.source}]${suggestion.confident ? "" : " (unticked)"}` : `nothing (${reason})`}`);
	}
}
process.stderr.write("\n");
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
console.log(`Notes that already have a type and key: ${stats.complete}`);
console.log(`  type suggested for ${stats.typeSuggested}, matching what's there: ${pct(stats.typeRight, stats.typeSuggested)}`);
console.log(`  key suggested for ${stats.keySuggested}, matching what's there: ${pct(stats.keyRight, stats.keySuggested)}`);
for (const [src, s] of Object.entries(stats.bySource)) {
	console.log(`  from ${src}: ${s.n} notes; type right ${pct(s.typeRight, s.type)} of ${s.type}, key right ${pct(s.keyRight, s.key)} of ${s.key}`);
}
console.log(`\nDisagreements (${wrong.length}):`);
for (const w of wrong) console.log(`  ${w}`);
console.log(`\nWhat it would suggest for the ${missing.length} notes missing a type or key:`);
for (const m of missing) console.log(`  ${m}`);

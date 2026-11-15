// Which tune notes do matches link to, and what did the `session:` rule
// change? `node eval/vault-links.mjs "<vault>/Trad Tunes"` prints, for every
// tune in the index whose vault note differs between matching by name only
// and matching with the notes' `session:` links, the old and the new note.
// Read-only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadIndexJson } from "./engine.mjs";
import { displayName } from "../src/names.ts";
import { VaultTunes, sessionTuneId } from "../src/vault-match.ts";

const dir = process.argv[2];
if (!dir) throw new Error("Give the tune notes folder");
const notes = [];
for (const f of readdirSync(dir)) {
	if (!f.endsWith(".md")) continue;
	const fm = readFileSync(join(dir, f), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
	const session = fm.match(/^session:\s*(\S+)/m)?.[1] ?? null;
	const inline = fm.match(/^aliases:\s*\[(.*)\]\s*$/m)?.[1];
	const block = fm.match(/^aliases:\s*\r?\n((?:\s+-\s.*\r?\n?)+)/m)?.[1];
	const strip = (s) => s.trim().replace(/^["']|["']$/g, "");
	const aliases = inline ? inline.split(",").map(strip).filter(Boolean) : block ? block.split("\n").map((l) => strip(l.replace(/^\s+-\s/, ""))).filter(Boolean) : [];
	notes.push({ basename: f.slice(0, -3), aliases, sessionTune: sessionTuneId(session) });
}
const byName = new VaultTunes(notes.map((n) => ({ ...n, sessionTune: null })));
const bySession = new VaultTunes(notes);
const { aliases } = await loadIndexJson();
const rows = [];
for (const [id, names] of Object.entries(aliases)) {
	const before = byName.find(names)?.basename ?? null;
	const afterNote = bySession.find(names, id);
	const after = afterNote?.basename ?? null;
	if (before === after) continue;
	const kind = !before ? "new link" : !after ? "link dropped" : "moved";
	const beforeNote = notes.find((n) => n.basename === before);
	rows.push({ kind, id, name: displayName(names[0]), before, beforeSession: beforeNote?.sessionTune ?? null, after, viaSession: afterNote?.sessionTune === id });
}
const withLink = notes.filter((n) => n.sessionTune).length;
console.log(`${notes.length} tune notes, ${withLink} with a session link; ${rows.length} index tunes link differently.\n`);
for (const kind of ["moved", "new link", "link dropped"]) {
	const list = rows.filter((r) => r.kind === kind);
	console.log(`## ${kind} (${list.length})\n`);
	console.log("| thesession tune | was | now | why |\n|---|---|---|---|");
	for (const r of list) {
		const why = r.viaSession ? "the new note's session link is this tune" : r.beforeSession ? `the old note's session link is tune ${r.beforeSession}` : "";
		console.log(`| [${r.name}](https://thesession.org/tunes/${r.id}) (${r.id}) | ${r.before ?? ""} | ${r.after ?? ""} | ${why} |`);
	}
	console.log("");
}
// Two notes claiming one tune: only the first is ever linked.
const claims = new Map();
for (const n of notes) if (n.sessionTune) claims.set(n.sessionTune, [...(claims.get(n.sessionTune) ?? []), n.basename]);
const dup = [...claims].filter(([, l]) => l.length > 1);
console.log(`## notes sharing a session tune (${dup.length})\n`);
for (const [id, l] of dup) console.log(`- tune ${id}: ${l.join(", ")}`);

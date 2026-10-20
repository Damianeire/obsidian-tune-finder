// The engine worker: FolkFriend's WebAssembly, the tune index, and the
// search. Runs off the main thread so Obsidian stays responsive.
//
// The tune index (35 MB from FolkFriend's server) is kept in IndexedDB, not
// in the vault, so it isn't synced and is shared by every vault on the
// device.
import { initSync, Engine } from "../engine/pkg/tune_finder_engine.js";
import wasmBytes from "../engine/pkg/tune_finder_engine_bg.wasm";
import { INDEX_META_URL, INDEX_URL, type IdentifyResult, type IndexInfo, type Request, type Response, type TuneInfo } from "./engine-protocol.ts";
import type { Candidate } from "./format.ts";
import { levenshtein, nameKey } from "./names.ts";
import { searchWithCorrection } from "./search.ts";

// The worker's global scope (the DOM typings describe a window instead).
declare const self: {
	postMessage(message: Response): void;
	onmessage: ((e: MessageEvent<{ id: number; req: Request }>) => void) | null;
};

initSync({ module: wasmBytes });
const engine = new Engine();
let aliases: Record<string, string[]> = {};
/** Tune ids by name key, built on first use. */
let nameIndex: Map<string, string[]> | null = null;

// ---------------------------------------------------------------- IndexedDB

const DB_NAME = "tune-finder";
const STORE = "index";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function dbGet<T>(key: string): Promise<T | undefined> {
	const db = await openDb();
	try {
		return await new Promise<T | undefined>((resolve, reject) => {
			const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
			req.onsuccess = () => resolve(req.result as T | undefined);
			req.onerror = () => reject(req.error);
		});
	} finally {
		db.close();
	}
}

async function dbPutAll(entries: [string, unknown][]): Promise<void> {
	const db = await openDb();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, "readwrite");
			for (const [key, value] of entries) tx.objectStore(STORE).put(value, key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

// ---------------------------------------------------------------- tune index

async function loadCached(): Promise<IndexInfo | null> {
	const info = await dbGet<IndexInfo>("info");
	if (!info) return null;
	const [json, aliasJson] = await Promise.all([dbGet<string>("index"), dbGet<string>("aliases")]);
	if (!json || !aliasJson) return null;
	engine.load_index(json);
	aliases = JSON.parse(aliasJson);
	nameIndex = null;
	return info;
}

async function fetchJsonWithProgress(url: string, onProgress: (loaded: number, total: number) => void): Promise<string> {
	const res = await fetch(url, { cache: "no-store" });
	if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
	const total = Number(res.headers.get("content-length")) || 35_000_000;
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	let reported = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		loaded += value.length;
		if (loaded - reported > 1_000_000) {
			reported = loaded;
			onProgress(loaded, total);
		}
	}
	const all = new Uint8Array(loaded);
	let offset = 0;
	for (const c of chunks) {
		all.set(c, offset);
		offset += c.length;
	}
	return new TextDecoder().decode(all);
}

async function fetchRemoteVersion(): Promise<number> {
	const res = await fetch(INDEX_META_URL, { cache: "no-store" });
	if (!res.ok) throw new Error(`Could not check the tune index version (${res.status})`);
	const meta = (await res.json()) as { v: number };
	return meta.v;
}

async function install(onProgress: (loaded: number, total: number) => void): Promise<IndexInfo> {
	const version = await fetchRemoteVersion().catch(() => 0);
	const text = await fetchJsonWithProgress(INDEX_URL, onProgress);
	const index = JSON.parse(text) as {
		settings: Record<string, { abc: string; composer?: string }>;
		aliases: Record<string, string[]>;
	};
	// The engine doesn't need the ABC; leaving it out halves the stored size.
	for (const s of Object.values(index.settings)) {
		s.abc = "";
		delete s.composer;
	}
	const json = JSON.stringify(index);
	const settings = engine.load_index(json);
	aliases = index.aliases;
	nameIndex = null;
	const info: IndexInfo = { version, savedAt: Date.now(), settings };
	await dbPutAll([
		["index", json],
		["aliases", JSON.stringify(index.aliases)],
		["info", info],
	]);
	return info;
}

// ---------------------------------------------------------------- identify

function identify(pcm: Float32Array, sampleRate: number, count: number, hint: number | null, explore: boolean): IdentifyResult {
	if (!engine.is_loaded()) throw new Error("The tune index isn't loaded");
	let contour: string;
	try {
		contour = engine.transcribe(pcm, sampleRate);
	} catch {
		throw new Error("No notes heard in this stretch of audio");
	}
	const query = (c: string): Candidate[] =>
		(JSON.parse(engine.query(c, count)) as Omit<Candidate, "aliases">[]).map((r) => ({
			...r,
			aliases: aliases[r.tune_id] ?? [r.name],
		}));
	const outcome = searchWithCorrection(contour, query, hint, explore);
	return {
		candidates: outcome.results,
		confidence: outcome.confidence,
		detune: outcome.detune,
		octaves: Math.round((outcome.shift - outcome.detune) / 12),
		shift: outcome.shift,
		notes: contour.length,
	};
}

// ---------------------------------------------------------------- names

/**
 * Tunes known by any of these names (compared ignoring "the", tune type,
 * accents and so on). If none, tunes with a close spelling of a longer name
 * ("Lisdoonvara" for "Lisdoonvarna").
 */
function lookupNames(names: string[]): TuneInfo[] {
	if (!engine.is_loaded()) throw new Error("The tune index isn't loaded");
	if (!nameIndex) {
		nameIndex = new Map();
		for (const [id, list] of Object.entries(aliases)) {
			for (const alias of list) {
				const key = nameKey(alias);
				if (!key) continue;
				const ids = nameIndex.get(key) ?? [];
				if (!ids.includes(id)) ids.push(id);
				nameIndex.set(key, ids);
			}
		}
	}
	const keys = names.map(nameKey).filter((k) => k.length > 0);
	const ids = new Set<string>();
	for (const key of keys) for (const id of nameIndex.get(key) ?? []) ids.add(id);
	let matchedBy: TuneInfo["matchedBy"] = "name";
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
	return [...ids].map((id) => ({
		tune_id: id,
		name: aliases[id]?.[0] ?? id,
		aliases: aliases[id] ?? [],
		settings: JSON.parse(engine.tune_settings(id)),
		matchedBy,
	}));
}

// ---------------------------------------------------------------- messages

async function handle(id: number, req: Request): Promise<unknown> {
	switch (req.type) {
		case "info":
			return (await dbGet<IndexInfo>("info")) ?? null;
		case "loadCached":
			return loadCached();
		case "install":
			return install((loaded, total) => self.postMessage({ id, progress: { loaded, total } } satisfies Response));
		case "remoteVersion":
			return fetchRemoteVersion();
		case "identify":
			return identify(req.pcm, req.sampleRate, req.count, req.hint, req.explore);
		case "lookupNames":
			return lookupNames(req.names);
	}
}

self.onmessage = async (e: MessageEvent<{ id: number; req: Request }>) => {
	const { id, req } = e.data;
	try {
		const value = await handle(id, req);
		self.postMessage({ id, ok: true, value } satisfies Response);
	} catch (err) {
		self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Response);
	}
};

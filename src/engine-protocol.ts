// Messages between the plugin and the engine worker.
import type { Candidate } from "./format.ts";
import type { Confidence } from "./search.ts";

export const INDEX_URL = "https://folkfriend-app-data.web.app/folkfriend-non-user-data.json";
export const INDEX_META_URL = "https://folkfriend-app-data.web.app/nud-meta.json";

/** What is known about the tune index stored on this device. */
export interface IndexInfo {
	/** FolkFriend's index version. It goes up by one a day. */
	version: number;
	/** When it was downloaded (ms since epoch). */
	savedAt: number;
	/** Number of tune settings. */
	settings: number;
}

export type Request =
	| { type: "info" }
	| { type: "loadCached" }
	| { type: "install" }
	| { type: "remoteVersion" }
	| { type: "identify"; pcm: Float32Array; sampleRate: number; count: number; hint: number | null; explore: boolean }
	| { type: "lookupNames"; names: string[] };

/** A tune on thesession.org and its settings (versions), oldest first. */
export interface TuneInfo {
	tune_id: string;
	/** FolkFriend's display alias, e.g. "silver spear, the". */
	name: string;
	aliases: string[];
	settings: { setting_id: string; dance: string; meter: string; mode: string }[];
	/** "name" for the same name; "spelling" for a close spelling, when nothing had the same name. */
	matchedBy: "name" | "spelling";
}

export interface IdentifyResult {
	candidates: Candidate[];
	confidence: Confidence;
	/** Semitones the recording seems to be away from concert pitch (0 when in tune). */
	detune: number;
	/** Octaves the transcription was moved by to match the index. */
	octaves: number;
	/** The whole shift used, in semitones (octaves and detune together). */
	shift: number;
	/** Length of the transcription in quavers. */
	notes: number;
}

export type Response =
	| { id: number; ok: true; value: unknown }
	| { id: number; ok: false; error: string }
	| { id: number; progress: { loaded: number; total: number } };

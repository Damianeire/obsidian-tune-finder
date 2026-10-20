// The plugin's handle on the engine worker: starts it when needed, makes
// sure the tune index is loaded (downloading it the first time), and stops
// the worker after a few idle minutes to give its memory back.
import workerCode from "inline-worker";
import type { IdentifyResult, IndexInfo, Request, Response, TuneInfo } from "./engine-protocol.ts";

/** Stop the worker after this long without use. */
const IDLE_MS = 5 * 60 * 1000;
/** Refresh the stored index once it is this many days behind FolkFriend's. */
const REFRESH_AFTER_DAYS = 28;

type Pending = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	onProgress?: (loaded: number, total: number) => void;
};

export interface ProgressReporter {
	/** Show or update a status message. */
	status(text: string): void;
}

export class EngineClient {
	private worker: Worker | null = null;
	private workerUrl: string | null = null;
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private idleTimer: number | null = null;
	private ready: Promise<IndexInfo> | null = null;
	private checkedForUpdate = false;

	/** Load the stored tune index, downloading or refreshing it if needed. */
	ensureIndex(progress: ProgressReporter): Promise<IndexInfo> {
		if (!this.ready) {
			this.ready = this.prepare(progress).catch((e) => {
				this.ready = null;
				throw e;
			});
		}
		return this.ready;
	}

	/**
	 * Identify a stretch of mono audio. `hint` is a shift that worked nearby in
	 * the same recording; `explore` false skips retrying weak results at other
	 * pitches.
	 */
	async identify(pcm: Float32Array, sampleRate: number, count: number, hint: number | null = null, explore = true): Promise<IdentifyResult> {
		return (await this.call({ type: "identify", pcm, sampleRate, count, hint, explore }, [pcm.buffer])) as IdentifyResult;
	}

	/** Tunes on thesession.org known by any of these names. */
	async lookupNames(names: string[]): Promise<TuneInfo[]> {
		return (await this.call({ type: "lookupNames", names })) as TuneInfo[];
	}

	/** Download the latest tune index now. */
	async refreshIndex(progress: ProgressReporter): Promise<IndexInfo> {
		this.ready = this.download(progress);
		try {
			return await this.ready;
		} catch (e) {
			this.ready = null;
			throw e;
		}
	}

	/** The stored index's details, without downloading anything. */
	async storedIndex(): Promise<IndexInfo | null> {
		return (await this.call({ type: "info" })) as IndexInfo | null;
	}

	dispose(): void {
		this.stopWorker(new Error("Tune Finder was unloaded"));
	}

	private async prepare(progress: ProgressReporter): Promise<IndexInfo> {
		const cached = (await this.call({ type: "loadCached" })) as IndexInfo | null;
		if (!cached) {
			progress.status("Downloading the tune index from FolkFriend (35 MB, first time only)...");
			return this.download(progress);
		}
		if (!this.checkedForUpdate) {
			this.checkedForUpdate = true;
			const remote = (await this.call({ type: "remoteVersion" }).catch(() => null)) as number | null;
			if (remote !== null && remote - cached.version >= REFRESH_AFTER_DAYS) {
				progress.status("Updating the tune index from FolkFriend (35 MB)...");
				return this.download(progress).catch(() => cached);
			}
		}
		return cached;
	}

	private async download(progress: ProgressReporter): Promise<IndexInfo> {
		return (await this.call({ type: "install" }, [], (loaded, total) => {
			const pct = Math.min(100, Math.round((100 * loaded) / total));
			progress.status(`Downloading the tune index: ${pct}%`);
		})) as IndexInfo;
	}

	private call(req: Request, transfer: Transferable[] = [], onProgress?: Pending["onProgress"]): Promise<unknown> {
		const worker = this.startWorker();
		const id = this.nextId++;
		this.touch();
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, onProgress });
			worker.postMessage({ id, req }, transfer);
		}).finally(() => this.touch());
	}

	private startWorker(): Worker {
		if (this.worker) return this.worker;
		this.workerUrl = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
		const worker = new Worker(this.workerUrl);
		worker.onmessage = (e: MessageEvent<Response>) => {
			const msg = e.data;
			const p = this.pending.get(msg.id);
			if (!p) return;
			if ("progress" in msg) {
				p.onProgress?.(msg.progress.loaded, msg.progress.total);
				return;
			}
			this.pending.delete(msg.id);
			if (msg.ok) p.resolve(msg.value);
			else p.reject(new Error(msg.error));
		};
		worker.onerror = (e) => {
			e.preventDefault();
			this.stopWorker(new Error(e.message || "The Tune Finder engine stopped unexpectedly"));
		};
		this.worker = worker;
		return worker;
	}

	private stopWorker(reason: Error): void {
		if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
		this.idleTimer = null;
		this.worker?.terminate();
		this.worker = null;
		if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
		this.workerUrl = null;
		this.ready = null;
		for (const p of this.pending.values()) p.reject(reason);
		this.pending.clear();
	}

	private touch(): void {
		if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
		this.idleTimer = window.setTimeout(() => {
			if (this.pending.size === 0) this.stopWorker(new Error("Stopped while idle"));
			else this.touch();
		}, IDLE_MS);
	}
}

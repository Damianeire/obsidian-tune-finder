// The results window: runs the identification one tune at a time, shows the
// candidates as they come in, lets you listen to each section and pick the
// right tune, then writes the picks into the note.
import { Modal, Notice, Platform, TFile, setIcon } from "obsidian";
import type TuneFinderPlugin from "./main.ts";
import { maxDecodeSeconds, SAMPLE_RATE, audioDuration, decodeAudioFile, monoSlice } from "./audio.ts";
import type { IdentifyResult } from "./engine-protocol.ts";
import { formatDance, formatKey, formatPlain, sessionUrl, type Candidate, type Choice, type DetectedSections } from "./format.ts";
import { formatTime } from "./loops.ts";
import { displayName } from "./names.ts";
import { analysisWindow, type Segment } from "./note-scan.ts";
import { scanRecording } from "./scan.ts";
import type { VaultTunes } from "./vault-match.ts";

export interface Job {
	segment: Segment;
	file: TFile;
	/** A whole recording with no loops block, which may be scanned for tune changes. */
	canScan: boolean;
}

type JobState =
	| { kind: "waiting" }
	| { kind: "scanning"; done: number; total: number }
	| { kind: "running" }
	| { kind: "done"; result: IdentifyResult }
	| { kind: "error"; message: string };

interface Row {
	job: Job;
	state: JobState;
	/** Index of the chosen candidate, or -1 for none. */
	selected: number;
	el: HTMLElement;
	bodyEl: HTMLElement;
	badgeEl: HTMLElement;
	hintEl: HTMLElement;
	playEl: HTMLElement;
}

export interface IdentifyModalOptions {
	title: string;
	jobs: Job[];
	vaultTunes: VaultTunes;
	insertLabel: string;
	/** Show the "name loop sections" and "add a list" options. */
	noteOptions: boolean;
	/**
	 * Writes the picks (and new loops blocks for scanned recordings) and
	 * returns a message for a notice. Without it there is only Copy.
	 */
	onInsert?: (choices: Choice[], detected: Map<string, DetectedSections>) => Promise<string>;
}

const BADGE: Record<string, string> = { likely: "Likely", possible: "Possible", unsure: "Unsure" };
/** When a whole recording is longer than this, suggest splitting it. */
const LONG_RECORDING_SECONDS = 90;

export class IdentifyModal extends Modal {
	private plugin: TuneFinderPlugin;
	private opts: IdentifyModalOptions;
	private rows: Row[] = [];
	/** Tune changes found in scanned recordings, by anchor key. */
	private detected = new Map<string, DetectedSections>();
	private listEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private insertButton: HTMLButtonElement | null = null;
	private copyButton!: HTMLButtonElement;
	private cancelled = false;
	private audio: HTMLAudioElement | null = null;
	private playing: Row | null = null;

	constructor(plugin: TuneFinderPlugin, opts: IdentifyModalOptions) {
		super(plugin.app);
		this.plugin = plugin;
		this.opts = opts;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("tf-modal");
		this.titleEl.setText(this.opts.title);
		this.statusEl = contentEl.createDiv({ cls: "tf-status" });

		this.listEl = contentEl.createDiv({ cls: "tf-rows" });
		for (const job of this.opts.jobs) this.rows.push(this.createRow(job));

		if (this.opts.noteOptions) {
			const options = contentEl.createDiv({ cls: "tf-options" });
			this.addOption(options, "Name loop sections", "nameLoops", 'Write picks into sections still called "Tune 1", "Tune 2 ?"');
			this.addOption(options, "Add a list with links", "addList", "List the picks with type, key and thesession.org links");
		}

		const footer = contentEl.createDiv({ cls: "tf-footer" });
		this.copyButton = footer.createEl("button", { text: "Copy" });
		this.copyButton.onclick = () => this.copy();
		if (this.opts.onInsert) {
			this.insertButton = footer.createEl("button", { text: this.opts.insertLabel, cls: "mod-cta" });
			this.insertButton.onclick = () => this.insert();
		}
		this.updateButtons();

		void this.run();
	}

	private addOption(parent: HTMLElement, text: string, key: "nameLoops" | "addList", tooltip: string): void {
		const label = parent.createEl("label", { cls: "tf-option", attr: { "aria-label": tooltip } });
		const box = label.createEl("input", { type: "checkbox" });
		box.checked = this.plugin.settings[key];
		box.onchange = async () => {
			this.plugin.settings[key] = box.checked;
			await this.plugin.saveSettings();
		};
		label.appendText(text);
	}

	onClose(): void {
		this.cancelled = true;
		this.stopAudio();
		this.contentEl.empty();
	}

	// ------------------------------------------------------------ running

	private setStatus(text: string): void {
		this.statusEl.setText(text);
		this.statusEl.toggleClass("tf-hidden", text === "");
	}

	private async run(): Promise<void> {
		try {
			this.setStatus("Loading the tune index...");
			await this.plugin.engine.ensureIndex({ status: (t) => this.setStatus(t) });
		} catch (e) {
			this.setStatus(`Couldn't load the tune index: ${(e as Error).message}`);
			for (const row of this.rows) this.setState(row, { kind: "error", message: "Not run" });
			return;
		}

		// One decode per recording, however many sections it has.
		const byFile = new Map<string, Row[]>();
		for (const row of this.rows) {
			const list = byFile.get(row.job.file.path) ?? [];
			list.push(row);
			byFile.set(row.job.file.path, list);
		}

		let done = 0;
		for (const rows of byFile.values()) {
			if (this.cancelled) return;
			const file = rows[0].job.file;
			this.setStatus(`Reading ${file.name}...`);
			const duration = await audioDuration(this.app, file);
			if (duration !== null && duration > maxDecodeSeconds(Platform.isMobile)) {
				for (const row of rows) {
					this.setState(row, {
						kind: "error",
						message: `This recording is ${formatTime(duration)} long, too long to analyse in one go. Split it into sets first (for example with trad-split).`,
					});
				}
				continue;
			}
			let buffer: AudioBuffer;
			try {
				buffer = await decodeAudioFile(this.app, file);
			} catch (e) {
				for (const row of rows) this.setState(row, { kind: "error", message: `Couldn't decode ${file.name}.` });
				continue;
			}
			const queue = [...rows];
			while (queue.length > 0) {
				if (this.cancelled) return;
				const row = queue.shift()!;
				if (row.job.canScan && this.plugin.settings.scanLongRecordings && buffer.duration > LONG_RECORDING_SECONDS) {
					const parts = await this.scanRow(row, buffer);
					if (this.cancelled) return;
					if (parts.length > 1) {
						queue.unshift(...parts);
						continue;
					}
				} else if (row.job.canScan && buffer.duration > LONG_RECORDING_SECONDS) {
					row.hintEl.setText(
						`This recording is ${formatTime(buffer.duration)} long. If it holds more than one tune, add loops first so each tune is identified on its own.`
					);
				}
				await this.identifyRow(row, buffer, ++done);
			}
		}
		this.setStatus("");
	}

	private async identifyRow(row: Row, buffer: AudioBuffer, n: number): Promise<void> {
		const win = analysisWindow(row.job.segment, buffer.duration, this.plugin.settings.analyseSeconds);
		if (win.end - win.start < 3) {
			this.setState(row, { kind: "error", message: "Too short to identify (under 3 seconds)." });
			return;
		}
		this.setState(row, { kind: "running" });
		this.setStatus(`Listening to ${this.rowName(row)} (${n} of ${this.rows.length})...`);
		try {
			const pcm = monoSlice(buffer, win.start, win.end);
			const result = await this.plugin.engine.identify(pcm, SAMPLE_RATE, Math.max(10, this.plugin.settings.candidates));
			this.setState(row, { kind: "done", result });
		} catch (e) {
			this.setState(row, { kind: "error", message: (e as Error).message });
		}
	}

	/**
	 * Look for tune changes in a whole recording. If there is more than one
	 * tune, its row is replaced by a row per tune, and the sections are kept
	 * for a new loops block. Returns the new rows, or none.
	 */
	private async scanRow(row: Row, buffer: AudioBuffer): Promise<Row[]> {
		this.setStatus(`Looking for tune changes in ${row.job.file.name}...`);
		const { sections } = await scanRecording(
			buffer.duration,
			(start, end) => monoSlice(buffer, start, end),
			async (pcm, hint, explore) => {
				const r = await this.plugin.engine.identify(pcm, SAMPLE_RATE, 10, hint, explore);
				return { candidates: r.candidates, shift: r.shift, likely: r.confidence === "likely" };
			},
			(done, total) => this.setState(row, { kind: "scanning", done, total }),
			() => this.cancelled
		);
		if (this.cancelled || sections.length < 2) return [];

		const job = row.job;
		this.detected.set(job.segment.anchorKey, { file: job.file.path, sections: sections.map((s) => ({ start: s.start, end: s.end })) });
		const parts = sections.map((s, i) =>
			this.createRow(
				{
					...job,
					canScan: false,
					segment: { ...job.segment, start: s.start, end: s.end, label: "", rangeText: `${formatTime(s.start)} - ${formatTime(s.end)}`, section: i + 1 },
				},
				row.el
			)
		);
		parts[0].hintEl.setText(
			`Found ${sections.length} tunes in ${job.file.name}. Adding to the note writes a loops block with these sections, which you can adjust in the player.`
		);
		row.el.remove();
		this.rows.splice(this.rows.indexOf(row), 1, ...parts);
		this.updateButtons();
		return parts;
	}

	// ------------------------------------------------------------ rows

	private rowName(row: Row): string {
		const s = row.job.segment;
		if (!s.rangeText) return row.job.file.basename;
		return s.label ? `${s.label} (${s.rangeText})` : s.rangeText;
	}

	/** A row for a job, at the end of the list or before `before`. */
	private createRow(job: Job, before?: HTMLElement): Row {
		const el = createDiv({ cls: "tf-row" });
		this.listEl.insertBefore(el, before ?? null);
		const head = el.createDiv({ cls: "tf-row-head" });
		const playEl = head.createDiv({ cls: "clickable-icon tf-play", attr: { "aria-label": "Listen" } });
		setIcon(playEl, "play");
		const titleEl = head.createDiv({ cls: "tf-row-title" });
		const s = job.segment;
		if (s.rangeText) {
			titleEl.createSpan({ text: s.rangeText, cls: "tf-range" });
			if (s.label) titleEl.createSpan({ text: s.label, cls: "tf-label" });
		} else {
			titleEl.createSpan({ text: job.file.name, cls: "tf-label" });
		}
		const badgeEl = head.createDiv({ cls: "tf-badge" });
		const hintEl = el.createDiv({ cls: "tf-hint" });
		const bodyEl = el.createDiv({ cls: "tf-row-body" });
		const row: Row = { job, state: { kind: "waiting" }, selected: -1, el, bodyEl, badgeEl, hintEl, playEl };
		playEl.onclick = () => this.togglePlay(row);
		this.renderBody(row);
		return row;
	}

	private setState(row: Row, state: JobState): void {
		row.state = state;
		if (state.kind === "done") {
			row.selected = state.result.confidence === "unsure" || state.result.candidates.length === 0 ? -1 : 0;
		}
		this.renderBody(row);
		this.updateButtons();
	}

	private titleFor(c: Candidate): { title: string; note: string | null } {
		const note = this.opts.vaultTunes.find(c.aliases);
		return { title: note ? note.basename : displayName(c.name), note: note ? note.basename : null };
	}

	private renderBody(row: Row): void {
		const { bodyEl, badgeEl, state } = row;
		bodyEl.empty();
		badgeEl.empty();
		badgeEl.className = "tf-badge";
		if (state.kind === "waiting") {
			bodyEl.createDiv({ text: "Waiting", cls: "tf-muted" });
			return;
		}
		if (state.kind === "running") {
			bodyEl.createDiv({ text: "Listening...", cls: "tf-muted" });
			return;
		}
		if (state.kind === "scanning") {
			bodyEl.createDiv({ text: `Looking for tune changes (${state.done} of ${state.total})...`, cls: "tf-muted" });
			return;
		}
		if (state.kind === "error") {
			bodyEl.createDiv({ text: state.message, cls: "tf-error" });
			return;
		}

		const { result } = state;
		badgeEl.setText(BADGE[result.confidence]);
		badgeEl.addClass(`tf-badge-${result.confidence}`);
		if (result.detune !== 0) {
			const n = Math.abs(result.detune);
			const amount = n === 1 ? "a semitone" : n === 2 ? "a tone" : `${n} semitones`;
			bodyEl.createDiv({
				text: `Matched ${amount} ${result.detune < 0 ? "lower" : "higher"} than it sounds: it may be played in another key, or off concert pitch.`,
				cls: "tf-muted tf-small",
			});
		}

		const name = `tf-${this.rows.indexOf(row)}-${Math.random().toString(36).slice(2, 8)}`;
		const list = bodyEl.createDiv({ cls: "tf-candidates" });
		const candidates = result.candidates.slice(0, this.plugin.settings.candidates);
		candidates.forEach((c, i) => {
			const label = list.createEl("label", { cls: "tf-candidate" });
			const radio = label.createEl("input", { type: "radio", attr: { name } });
			radio.checked = row.selected === i;
			radio.onchange = () => {
				row.selected = i;
				this.updateButtons();
			};
			const text = label.createDiv({ cls: "tf-candidate-text" });
			const { title, note } = this.titleFor(c);
			const line = text.createDiv({ cls: "tf-candidate-line" });
			line.createSpan({ text: title, cls: "tf-candidate-name" });
			if (note) line.createSpan({ text: "in vault", cls: "tf-in-vault" });
			const meta = text.createDiv({ cls: "tf-candidate-meta" });
			meta.appendText([formatDance(c.dance), formatKey(c.mode), `${Math.round(c.score * 100)}% match`].join(" · ") + " · ");
			const link = meta.createEl("a", { text: "thesession", href: sessionUrl(c) });
			link.onclick = (e) => e.stopPropagation();
			const others = [...new Set(c.aliases.map(displayName))].filter((a) => a !== title).slice(0, 3);
			if (others.length) text.createDiv({ text: `Also known as ${others.join(", ")}`, cls: "tf-muted tf-small" });
		});
		const none = list.createEl("label", { cls: "tf-candidate tf-none" });
		const noneRadio = none.createEl("input", { type: "radio", attr: { name } });
		noneRadio.checked = row.selected === -1;
		noneRadio.onchange = () => {
			row.selected = -1;
			this.updateButtons();
		};
		none.createDiv({ text: candidates.length ? "None of these" : "Nothing found", cls: "tf-candidate-text" });
	}

	// ------------------------------------------------------------ results

	private choices(): Choice[] {
		const out: Choice[] = [];
		for (const row of this.rows) {
			if (row.state.kind !== "done" || row.selected < 0) continue;
			const candidate = row.state.result.candidates[row.selected];
			if (!candidate) continue;
			const { title, note } = this.titleFor(candidate);
			out.push({ segment: row.job.segment, candidate, title, note });
		}
		return out;
	}

	private updateButtons(): void {
		if (!this.copyButton) return;
		const finished = this.rows.every((r) => r.state.kind === "done" || r.state.kind === "error");
		const any = this.choices().length > 0 || this.detected.size > 0;
		if (this.insertButton) this.insertButton.disabled = !finished || !any;
		this.copyButton.disabled = !finished || !any;
	}

	private async copy(): Promise<void> {
		await navigator.clipboard.writeText(formatPlain(this.choices()));
		new Notice("Copied");
	}

	private async insert(): Promise<void> {
		if (!this.opts.onInsert || !this.insertButton) return;
		this.insertButton.disabled = true;
		try {
			const message = await this.opts.onInsert(this.choices(), this.detected);
			new Notice(message);
			this.close();
		} catch (e) {
			new Notice(`Couldn't add the tunes: ${(e as Error).message}`);
			this.updateButtons();
		}
	}

	// ------------------------------------------------------------ listening

	private togglePlay(row: Row): void {
		if (this.playing === row) {
			this.stopAudio();
			return;
		}
		this.stopAudio();
		const seg = row.job.segment;
		const audio = new Audio(this.app.vault.getResourcePath(row.job.file));
		const stopAt = seg.end ?? seg.start + this.plugin.settings.analyseSeconds;
		audio.onloadedmetadata = () => {
			audio.currentTime = seg.start;
			void audio.play();
		};
		audio.ontimeupdate = () => {
			if (stopAt > seg.start && audio.currentTime >= stopAt) this.stopAudio();
		};
		audio.onended = () => this.stopAudio();
		this.audio = audio;
		this.playing = row;
		setIcon(row.playEl, "square");
		row.playEl.setAttr("aria-label", "Stop");
	}

	private stopAudio(): void {
		if (this.audio) {
			this.audio.pause();
			this.audio.removeAttribute("src");
			this.audio.load();
		}
		if (this.playing) {
			setIcon(this.playing.playEl, "play");
			this.playing.playEl.setAttr("aria-label", "Listen");
		}
		this.audio = null;
		this.playing = null;
	}
}

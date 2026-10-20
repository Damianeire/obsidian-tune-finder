// "Fill in missing types and keys": suggests `type` and `key` for tune notes
// that lack them, first by name (quick), then by listening to each note's
// own recording, and writes only the ticked suggestions, only into empty
// fields.
import { Modal, Notice, Platform, TFile } from "obsidian";
import type TuneFinderPlugin from "./main.ts";
import { maxDecodeSeconds, SAMPLE_RATE, audioDuration, decodeAudioFile, monoSlice } from "./audio.ts";
import { heardTune, isEmptyValue, ownTuneSegment, suggestDetails, type Heard, type Needs, type Suggestion } from "./details.ts";
import type { TuneInfo } from "./engine-protocol.ts";
import { analysisWindow } from "./note-scan.ts";

interface NoteRow {
	file: TFile;
	names: string[];
	needs: Needs;
	byName: TuneInfo[];
	suggestion: Suggestion | null;
	reason: string;
	checked: boolean;
	/** The tick box was changed by hand, so later results don't reset it. */
	touched: boolean;
}

export class DetailsModal extends Modal {
	private plugin: TuneFinderPlugin;
	private notes: TFile[];
	private rows: NoteRow[] = [];
	private statusEl!: HTMLElement;
	private listEl!: HTMLElement;
	private skippedEl!: HTMLElement;
	private applyButton!: HTMLButtonElement;
	private cancelled = false;

	constructor(plugin: TuneFinderPlugin, notes: TFile[]) {
		super(plugin.app);
		this.plugin = plugin;
		this.notes = notes;
	}

	onOpen(): void {
		this.modalEl.addClass("tf-modal");
		this.titleEl.setText("Fill in missing types and keys");
		const { contentEl } = this;
		contentEl.createDiv({
			text: "Only empty fields are filled, and only for the notes you tick. Suggestions from your own recordings come first; the rest are by the tune's name on thesession.org.",
			cls: "tf-muted tf-small",
		});
		this.statusEl = contentEl.createDiv({ cls: "tf-status" });
		this.listEl = contentEl.createDiv({ cls: "tf-rows" });
		this.skippedEl = contentEl.createDiv({ cls: "tf-skipped" });
		const footer = contentEl.createDiv({ cls: "tf-footer" });
		this.applyButton = footer.createEl("button", { text: "Fill in ticked notes", cls: "mod-cta" });
		this.applyButton.disabled = true;
		this.applyButton.onclick = () => this.apply();
		void this.run();
	}

	onClose(): void {
		this.cancelled = true;
		this.contentEl.empty();
	}

	private setStatus(text: string): void {
		this.statusEl.setText(text);
		this.statusEl.toggleClass("tf-hidden", text === "");
	}

	private needsOf(file: TFile): Needs {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		return { type: isEmptyValue(fm.type), key: isEmptyValue(fm.key) };
	}

	private async run(): Promise<void> {
		try {
			await this.plugin.engine.ensureIndex({ status: (t) => this.setStatus(t) });
		} catch (e) {
			this.setStatus(`Couldn't load the tune index: ${(e as Error).message}`);
			return;
		}

		// By name: quick, for every note.
		this.setStatus(`Looking up ${this.notes.length} tune names...`);
		for (const file of this.notes) {
			if (this.cancelled) return;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			const raw: unknown = fm.aliases ?? fm.alias;
			const names = [file.basename, ...(Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [])];
			const needs = this.needsOf(file);
			const byName = await this.plugin.engine.lookupNames(names);
			const { suggestion, reason } = suggestDetails(needs, byName, null, file.basename);
			this.rows.push({ file, names, needs, byName, suggestion, reason, checked: suggestion?.confident ?? false, touched: false });
		}
		this.render();
		this.applyButton.disabled = false;

		// Then each note's own recording, which is slower but knows the key it is played in.
		const withAudio: { row: NoteRow; file: TFile; start: number; end: number | null }[] = [];
		for (const row of this.rows) {
			const text = await this.app.vault.cachedRead(row.file);
			const seg = ownTuneSegment(text, row.names);
			if (!seg) continue;
			const audio = this.plugin.resolveAudio(seg.link, row.file.path);
			if (audio) withAudio.push({ row, file: audio, start: seg.start, end: seg.end });
		}
		for (let i = 0; i < withAudio.length; i++) {
			if (this.cancelled) return;
			const { row, file, start, end } = withAudio[i];
			this.setStatus(`Listening to the recordings: ${i + 1} of ${withAudio.length} (${row.file.basename})...`);
			const heard = await this.listen(file, start, end, row.names);
			if (!heard || this.cancelled) continue;
			const { suggestion, reason } = suggestDetails(row.needs, row.byName, heard, row.file.basename);
			row.suggestion = suggestion;
			row.reason = reason;
			if (!row.touched) row.checked = suggestion?.confident ?? false;
			this.render();
		}
		this.setStatus("");
	}

	/** Identify the note's tune in its recording; the match with the note's name, if any. */
	private async listen(file: TFile, start: number, end: number | null, names: string[]): Promise<Heard | null> {
		try {
			const duration = await audioDuration(this.app, file);
			if (duration !== null && duration > maxDecodeSeconds(Platform.isMobile)) return null;
			const buffer = await decodeAudioFile(this.app, file);
			const win = analysisWindow(
				{ anchorKey: "", link: file.path, start, end, label: "", rangeText: "", section: 0 },
				buffer.duration,
				this.plugin.settings.analyseSeconds
			);
			if (win.end - win.start < 3) return null;
			const result = await this.plugin.engine.identify(monoSlice(buffer, win.start, win.end), SAMPLE_RATE, 10);
			const candidate = heardTune(result.candidates, names);
			return candidate ? { candidate, detune: result.detune } : null;
		} catch {
			return null;
		}
	}

	private render(): void {
		this.listEl.empty();
		const suggested = this.rows.filter((r) => r.suggestion);
		if (suggested.length === 0) this.listEl.createDiv({ text: "No suggestions.", cls: "tf-muted" });
		for (const row of suggested) {
			const s = row.suggestion!;
			const el = this.listEl.createEl("label", { cls: "tf-candidate tf-detail-row" });
			const box = el.createEl("input", { type: "checkbox" });
			box.checked = row.checked;
			box.onchange = () => {
				row.checked = box.checked;
				row.touched = true;
			};
			const text = el.createDiv({ cls: "tf-candidate-text" });
			const line = text.createDiv({ cls: "tf-candidate-line" });
			const link = line.createEl("a", { text: row.file.basename, cls: "tf-candidate-name" });
			link.onclick = (e) => {
				e.preventDefault();
				void this.app.workspace.getLeaf(true).openFile(row.file);
			};
			const values = [s.type ? `type ${s.type}` : "", s.key ? `key ${s.key}` : ""].filter(Boolean).join(", ");
			line.createSpan({ text: `: ${values}` });
			text.createDiv({ text: s.source, cls: "tf-candidate-meta" });
		}

		this.skippedEl.empty();
		const skipped = this.rows.filter((r) => !r.suggestion);
		if (skipped.length) {
			const details = this.skippedEl.createEl("details");
			details.createEl("summary", { text: `No suggestion for ${skipped.length} ${skipped.length === 1 ? "note" : "notes"}`, cls: "tf-muted tf-small" });
			const ul = details.createEl("ul", { cls: "tf-small" });
			for (const r of skipped) ul.createEl("li", { text: `${r.file.basename}: ${r.reason}` });
		}
	}

	private async apply(): Promise<void> {
		this.cancelled = true;
		this.applyButton.disabled = true;
		let types = 0;
		let keys = 0;
		for (const row of this.rows) {
			if (!row.checked || !row.suggestion) continue;
			const { type, key } = row.suggestion;
			await this.app.fileManager.processFrontMatter(row.file, (fm: Record<string, unknown>) => {
				// Only empty fields, checked again now in case the note changed.
				if (type && isEmptyValue(fm.type)) {
					fm.type = type;
					types++;
				}
				if (key && isEmptyValue(fm.key)) {
					fm.key = key;
					keys++;
				}
			});
		}
		new Notice(`Filled in ${types} ${types === 1 ? "type" : "types"} and ${keys} ${keys === 1 ? "key" : "keys"}.`);
		this.close();
	}
}

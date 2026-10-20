import { FuzzySuggestModal, MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import { DetailsModal } from "./details-modal.ts";
import { isEmptyValue } from "./details.ts";
import { EngineClient } from "./engine-client.ts";
import { formatChoice, formatPlain, insertChoices, type Choice, type InsertResult } from "./format.ts";
import { IdentifyModal, type Job } from "./identify-modal.ts";
import { AUDIO_EXTENSIONS, findAnchors, isAudioPath, segmentsFor } from "./note-scan.ts";
import { DEFAULT_SETTINGS, TuneFinderSettingTab, type TuneFinderSettings } from "./settings.ts";
import { VaultTunes, type TuneNote } from "./vault-match.ts";

export default class TuneFinderPlugin extends Plugin {
	settings!: TuneFinderSettings;
	engine!: EngineClient;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.engine = new EngineClient();

		this.addCommand({
			id: "identify-tunes-in-note",
			name: "Identify tunes in this note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.identifyNote(file);
				return true;
			},
		});

		this.addCommand({
			id: "identify-tune-in-file",
			name: "Identify tune in an audio file",
			callback: () => new AudioFileSuggest(this).open(),
		});

		this.addCommand({
			id: "fill-missing-types-and-keys",
			name: "Fill in missing tune types and keys",
			callback: () => {
				const notes = this.tuneNotesMissingDetails();
				if (notes.length === 0) {
					new Notice(`Every note in ${this.settings.tuneFolder || "the vault"} already has a type and key.`);
					return;
				}
				new DetailsModal(this, notes).open();
			},
		});

		this.addCommand({
			id: "update-tune-index",
			name: "Update the tune index",
			callback: async () => {
				const notice = new Notice("Downloading the tune index...", 0);
				try {
					const info = await this.engine.refreshIndex({ status: (t) => notice.setMessage(t) });
					notice.setMessage(`Tune index updated: ${info.settings.toLocaleString()} tune settings.`);
				} catch (e) {
					notice.setMessage(`Couldn't update the tune index: ${(e as Error).message}`);
				}
				window.setTimeout(() => notice.hide(), 5000);
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile)) return;
				if (isAudioPath(file.path)) {
					menu.addItem((item) =>
						item
							.setTitle("Identify tune")
							.setIcon("music")
							.onClick(() => this.identifyAudioFile(file))
					);
				} else if (file.extension === "md" && this.hasAudioEmbeds(file)) {
					menu.addItem((item) =>
						item
							.setTitle("Identify tunes in note")
							.setIcon("music")
							.onClick(() => this.identifyNote(file))
					);
				}
			})
		);

		this.addSettingTab(new TuneFinderSettingTab(this.app, this));
	}

	onunload(): void {
		this.engine.dispose();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ------------------------------------------------------------ commands

	/** Identify every loop section (or whole recording) in a note, then write the picks under each. */
	async identifyNote(note: TFile): Promise<void> {
		const text = await this.app.vault.cachedRead(note);
		const jobs: Job[] = [];
		const missing: string[] = [];
		for (const anchor of findAnchors(text)) {
			const audio = this.resolveAudio(anchor.link, note.path);
			if (!audio) {
				missing.push(anchor.link);
				continue;
			}
			const canScan = anchor.loops === null && anchor.listIndent === null;
			for (const segment of segmentsFor(anchor)) jobs.push({ segment, file: audio, canScan });
		}
		if (missing.length) new Notice(`Can't find ${missing.map((m) => `"${m}"`).join(", ")}`);
		if (jobs.length === 0) {
			new Notice("No audio in this note to identify.");
			return;
		}

		new IdentifyModal(this, {
			title: `Identify tunes: ${note.basename}`,
			jobs,
			vaultTunes: this.vaultTunes(),
			insertLabel: "Add to note",
			noteOptions: true,
			onInsert: async (choices, detected) => {
				let result: InsertResult | null = null;
				await this.app.vault.process(note, (current) => {
					result = insertChoices(current, choices, {
						nameLoops: this.settings.nameLoops,
						addList: this.settings.addList,
						detected,
					});
					return result.text;
				});
				return insertMessage(result!, note.basename);
			},
		}).open();
	}

	/** Identify a single recording; the pick goes in at the cursor if a note is open for editing. */
	identifyAudioFile(file: TFile): void {
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
		new IdentifyModal(this, {
			title: `Identify tune: ${file.basename}`,
			jobs: [{ segment: { anchorKey: "", link: file.path, start: 0, end: null, label: "", rangeText: "", section: 0 }, file, canScan: true }],
			vaultTunes: this.vaultTunes(),
			insertLabel: "Insert at cursor",
			noteOptions: false,
			onInsert: editor
				? async (choices: Choice[]) => {
						editor.replaceSelection(choices.length === 1 && !choices[0].segment.rangeText ? `Identified tune: ${formatChoice(choices[0])}` : formatPlain(choices));
						return "Inserted";
					}
				: undefined,
		}).open();
	}

	// ------------------------------------------------------------ helpers

	private hasAudioEmbeds(file: TFile): boolean {
		const embeds = this.app.metadataCache.getFileCache(file)?.embeds ?? [];
		return embeds.some((e) => isAudioPath(e.link.split("#")[0]));
	}

	/** A `file:` path or embed link, resolved the way audio-loop-player does, then by name ignoring case. */
	resolveAudio(link: string, sourcePath: string): TFile | null {
		const isAudio = (f: unknown): f is TFile => f instanceof TFile && isAudioPath(f.path);
		const exact = this.app.vault.getAbstractFileByPath(normalizePath(link));
		if (isAudio(exact)) return exact;
		const linked = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
		if (isAudio(linked)) return linked;
		const wanted = link.toLowerCase();
		const name = wanted.split("/").pop() ?? wanted;
		const files = this.app.vault.getFiles().filter(isAudio);
		return files.find((f) => f.path.toLowerCase() === wanted) ?? files.find((f) => f.name.toLowerCase() === name) ?? null;
	}

	/** Tune notes (in the tune folder) with an empty `type` or `key`. */
	tuneNotesMissingDetails(): TFile[] {
		const folder = this.settings.tuneFolder;
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => !folder || f.path.startsWith(`${folder}/`))
			.filter((f) => {
				const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
				return fm !== undefined && (isEmptyValue(fm.type) || isEmptyValue(fm.key));
			})
			.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	/** The tune notes matches can link to, with their frontmatter aliases. */
	vaultTunes(): VaultTunes {
		const folder = this.settings.tuneFolder;
		const notes: TuneNote[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (folder && !file.path.startsWith(`${folder}/`)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const raw: unknown = fm?.aliases ?? fm?.alias;
			const aliases = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
			notes.push({ basename: file.basename, aliases });
		}
		return new VaultTunes(notes);
	}
}

class AudioFileSuggest extends FuzzySuggestModal<TFile> {
	private plugin: TuneFinderPlugin;

	constructor(plugin: TuneFinderPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.setPlaceholder("Choose a recording to identify");
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => AUDIO_EXTENSIONS.includes(f.extension.toLowerCase()));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.plugin.identifyAudioFile(file);
	}
}

/** "Named 3 loop sections and listed 3 tunes in Set 1", from what was written. */
function insertMessage(r: InsertResult, noteName: string): string {
	const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const parts: string[] = [];
	if (r.blocks) parts.push(`added ${count(r.blocks, "loops block", "loops blocks")}`);
	if (r.named) parts.push(`named ${count(r.named, "loop section", "loop sections")}`);
	if (r.listed) parts.push(`listed ${count(r.listed, "tune", "tunes")}`);
	let message = parts.length
		? `${parts.join(", ").replace(/, ([^,]*)$/, " and $1").replace(/^./, (c) => c.toUpperCase())} in ${noteName}.`
		: "Nothing to change: those loop sections already have names, and the list is turned off.";
	if (r.missing.length) message += " The note changed while identifying, so some recordings weren't found; run it again.";
	return message;
}


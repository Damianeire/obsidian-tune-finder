import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type TuneFinderPlugin from "./main.ts";

export interface TuneFinderSettings {
	/** Seconds of each tune or loop section to analyse, from its start. 0 = all of it. */
	analyseSeconds: number;
	/** How many candidates to list for each tune. */
	candidates: number;
	/** Folder of tune notes to link matches to. Empty = whole vault. */
	tuneFolder: string;
	/** Write picks into loop sections still called "Tune 1", "Tune 2 ?". */
	nameLoops: boolean;
	/** Add an "Identified tunes:" list with type, key and links. */
	addList: boolean;
	/** Scan long recordings with no loops block for tune changes. */
	scanLongRecordings: boolean;
}

export const DEFAULT_SETTINGS: TuneFinderSettings = {
	analyseSeconds: 60,
	candidates: 5,
	tuneFolder: "Trad Tunes",
	nameLoops: true,
	addList: true,
	scanLongRecordings: true,
};

export class TuneFinderSettingTab extends PluginSettingTab {
	plugin: TuneFinderPlugin;

	constructor(app: App, plugin: TuneFinderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Seconds to analyse")
			.setDesc(
				"How much of each tune or loop section to listen to, from its start. A minute covers a reel played through once. Longer is slower and rarely helps. 0 listens to all of it."
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 180, 15)
					.setValue(this.plugin.settings.analyseSeconds)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.analyseSeconds = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Candidates to show")
			.setDesc("How many possible tunes to list for each recording or section.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ "3": "3", "5": "5", "10": "10" })
					.setValue(String(this.plugin.settings.candidates))
					.onChange(async (value) => {
						this.plugin.settings.candidates = parseInt(value, 10);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Tune notes folder")
			.setDesc("Matches become links to tune notes in this folder, by name or alias. Leave empty to look through the whole vault.")
			.addText((text) =>
				text
					.setPlaceholder("Trad Tunes")
					.setValue(this.plugin.settings.tuneFolder)
					.onChange(async (value) => {
						this.plugin.settings.tuneFolder = value.trim().replace(/^\/+|\/+$/g, "");
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Adding to a note").setHeading();

		new Setting(containerEl)
			.setName("Name loop sections")
			.setDesc(
				'Write the tune you pick into loop sections still called "Tune 1", "Tune 2 ?" and so on. Sections you have named yourself are never changed. trad-split\'s Export tunes uses these names.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.nameLoops).onChange(async (value) => {
					this.plugin.settings.nameLoops = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Add a list of identified tunes")
			.setDesc("Under each recording or loops block, list the tunes picked, with type, key and a link to thesession.org.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.addList).onChange(async (value) => {
					this.plugin.settings.addList = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Find tune changes in long recordings")
			.setDesc(
				"When a recording longer than a minute and a half has no loops block, look for where the tunes change and offer a loops block with a section for each tune. It takes a while: roughly a second for every ten seconds of music."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.scanLongRecordings).onChange(async (value) => {
					this.plugin.settings.scanLongRecordings = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Tune index").setHeading();
		const indexSetting = new Setting(containerEl).setName("Stored copy").setDesc("Checking...");
		indexSetting.addButton((button) =>
			button.setButtonText("Update now").onClick(async () => {
				button.setDisabled(true);
				const notice = new Notice("Downloading the tune index...", 0);
				try {
					const info = await this.plugin.engine.refreshIndex({ status: (t) => notice.setMessage(t) });
					notice.setMessage(`Tune index updated: ${info.settings.toLocaleString()} tune settings.`);
					window.setTimeout(() => notice.hide(), 4000);
				} catch (e) {
					notice.setMessage(`Couldn't update the tune index: ${(e as Error).message}`);
					window.setTimeout(() => notice.hide(), 8000);
				}
				button.setDisabled(false);
				this.display();
			})
		);
		this.plugin.engine
			.storedIndex()
			.then((info) => {
				indexSetting.setDesc(
					info
						? `${info.settings.toLocaleString()} tune settings from thesession.org, downloaded ${new Date(info.savedAt).toLocaleDateString()}. It updates itself every four weeks.`
						: "Not downloaded yet. It is fetched from FolkFriend (35 MB) the first time you identify a tune."
				);
			})
			.catch(() => indexSetting.setDesc("Couldn't read the stored tune index."));

		const credits = containerEl.createDiv({ cls: "setting-item-description tf-credits" });
		credits.appendText("Transcription and search by ");
		credits.createEl("a", { text: "FolkFriend", href: "https://folkfriend.app" });
		credits.appendText(" (Tom Wyllie, GPL-3.0). Tune data from ");
		credits.createEl("a", { text: "thesession.org", href: "https://thesession.org" });
		credits.appendText(".");
	}
}

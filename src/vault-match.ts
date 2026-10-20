// Linking search results to the tune notes already in the vault, using every
// name thesession.org knows the tune by. Pure; the caller supplies the notes.
import { nameKey, namesMatch } from "./names.ts";

export interface TuneNote {
	/** Note name without ".md", used for the [[link]]. */
	basename: string;
	/** Frontmatter aliases. */
	aliases: string[];
}

export class VaultTunes {
	private byKey = new Map<string, TuneNote>();
	private notes: TuneNote[];

	constructor(notes: TuneNote[]) {
		this.notes = notes;
		for (const note of notes) {
			for (const name of [note.basename, ...note.aliases]) {
				const key = nameKey(name);
				if (key && !this.byKey.has(key)) this.byKey.set(key, note);
			}
		}
	}

	/** The vault note for a tune with these names, if there is one. */
	find(names: string[]): TuneNote | null {
		for (const name of names) {
			const hit = this.byKey.get(nameKey(name));
			if (hit) return hit;
		}
		// Close spellings ("Blackberry Blossum"), but only when exactly one note fits.
		const fuzzy = new Set<TuneNote>();
		for (const note of this.notes) {
			if (names.some((n) => [note.basename, ...note.aliases].some((v) => namesMatch(n, v)))) fuzzy.add(note);
		}
		return fuzzy.size === 1 ? [...fuzzy][0] : null;
	}
}

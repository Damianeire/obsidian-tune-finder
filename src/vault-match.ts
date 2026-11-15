// Linking search results to the tune notes already in the vault, using every
// name thesession.org knows the tune by. Pure; the caller supplies the notes.
import { nameKey, namesMatch } from "./names.ts";

export interface TuneNote {
	/** Note name without ".md", used for the [[link]]. */
	basename: string;
	/** Frontmatter aliases. */
	aliases: string[];
	/** thesession.org tune id from the note's `session` property, when it has one. */
	sessionTune?: string | null;
}

/** "https://thesession.org/tunes/667#setting13706" -> "667". */
export function sessionTuneId(value: unknown): string | null {
	const m = typeof value === "string" ? value.match(/thesession\.org\/tunes\/(\d+)/) : null;
	return m ? m[1] : null;
}

export class VaultTunes {
	private byKey = new Map<string, TuneNote[]>();
	private byTune = new Map<string, TuneNote>();
	private notes: TuneNote[];

	constructor(notes: TuneNote[]) {
		this.notes = notes;
		for (const note of notes) {
			if (note.sessionTune && !this.byTune.has(note.sessionTune)) this.byTune.set(note.sessionTune, note);
			for (const name of [note.basename, ...note.aliases]) {
				const key = nameKey(name);
				if (!key) continue;
				const list = this.byKey.get(key) ?? [];
				if (!list.includes(note)) list.push(note);
				this.byKey.set(key, list);
			}
		}
	}

	/**
	 * The vault note for a tune with these names, if there is one. With the
	 * tune's thesession.org id, a note whose `session` link is that tune wins,
	 * and a note linked to a different tune is never matched by name alone:
	 * "The Killavil" (a jig) is not the note "Killavil Reel", and two tunes
	 * both known as "Charlie Lennon's" don't share a note.
	 */
	find(names: string[], tuneId: string | null = null): TuneNote | null {
		if (tuneId) {
			const linked = this.byTune.get(tuneId);
			if (linked) return linked;
		}
		const fits = (note: TuneNote) => !tuneId || !note.sessionTune || note.sessionTune === tuneId;
		for (const name of names) {
			const hit = (this.byKey.get(nameKey(name)) ?? []).find(fits);
			if (hit) return hit;
		}
		// Close spellings ("Blackberry Blossum"), but only when exactly one note fits.
		const fuzzy = new Set<TuneNote>();
		for (const note of this.notes) {
			if (!fits(note)) continue;
			if (names.some((n) => [note.basename, ...note.aliases].some((v) => namesMatch(n, v)))) fuzzy.add(note);
		}
		return fuzzy.size === 1 ? [...fuzzy][0] : null;
	}
}

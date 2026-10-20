// Tune-name normalisation and matching. Pure functions with no Obsidian
// imports, so they run under Node for the tests and the evaluation script.

const NUMBER_WORDS: Record<string, string> = {
	"1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
	"7": "seven", "8": "eight", "9": "nine", "10": "ten", "11": "eleven", "12": "twelve",
};

// Words that say what kind of tune it is, or are articles, rather than
// naming it. "The Silver Spear", "Silver Spear Reel" and "silver spear, the"
// all reduce to the same key.
const FILLER_WORDS = new Set([
	"the", "an", "a", "na", "no", "number", "tune", "tunes",
	"reel", "reels", "jig", "jigs", "slip", "single", "double", "polka", "polkas",
	"slide", "slides", "hornpipe", "hornpipes", "barndance", "barn", "dance",
	"fling", "highland", "march", "waltz", "mazurka", "air", "slow", "set",
]);

/** Lower-case words with accents, apostrophes and filler words removed. */
export function nameTokens(name: string): string[] {
	return name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/['‘’`]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter((w) => w.length > 0)
		.map((w) => NUMBER_WORDS[w] ?? w)
		.filter((w) => !FILLER_WORDS.has(w));
}

/** A single comparison key: the name's significant words run together. */
export function nameKey(name: string): string {
	return nameTokens(name).join("");
}

export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(
				prev[j] + 1,
				cur[j - 1] + 1,
				prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		prev = cur;
	}
	return prev[b.length];
}

export interface MatchOptions {
	/** Allow one key to contain the other, e.g. a messy file name. */
	allowContains?: boolean;
}

/**
 * Do two tune names refer to the same tune? Equal keys always match. Close
 * spellings ("Blackberry Blossum") match when the keys are long enough for
 * one or two typos to be safe.
 */
export function namesMatch(a: string, b: string, opts: MatchOptions = {}): boolean {
	const ka = nameKey(a);
	const kb = nameKey(b);
	if (ka.length === 0 || kb.length === 0) return false;
	if (ka === kb) return true;
	const shorter = Math.min(ka.length, kb.length);
	if (opts.allowContains && shorter >= 6 && (ka.includes(kb) || kb.includes(ka))) return true;
	if (shorter >= 8) {
		const longer = Math.max(ka.length, kb.length);
		return 1 - levenshtein(ka, kb) / longer >= 0.85;
	}
	return false;
}

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "na", "an", "ar", "le"]);

function capitaliseWord(word: string, first: boolean): string {
	if (!first && SMALL_WORDS.has(word)) return word;
	// O'Neill, Mc/Mac names are left alone after the first letter apart from
	// the letter after "O'", which is always capitalised.
	let out = word.charAt(0).toUpperCase() + word.slice(1);
	out = out.replace(/^O'([a-z])/, (_, c: string) => "O'" + c.toUpperCase());
	out = out.replace(/^Mc([a-z])/, (_, c: string) => "Mc" + c.toUpperCase());
	return out;
}

/**
 * Turn a FolkFriend alias ("soup dragon, the") into a display title
 * ("The Soup Dragon").
 */
export function displayName(alias: string): string {
	let s = alias.trim();
	const m = s.match(/^(.*),\s*(the|an|a)$/i);
	if (m) s = `${m[2]} ${m[1]}`;
	return s
		.split(/\s+/)
		.map((w, i) => w.split("-").map((part, j) => capitaliseWord(part, i === 0 && j === 0)).join("-"))
		.join(" ");
}

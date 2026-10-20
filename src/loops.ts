// The `loops` code block format of the audio-loop-player plugin, as written
// by trad-split:
//
//     file: Sessions/Set 1.m4a
//     select: 2 loop
//     0:00 - 2:18 | Tune 1
//     2:18 - 4:34.3 | Tune 2 ?
//
// The grammar matches audio-loop-player's parseLoopsBlock, so anything the
// player accepts is read the same way here.

export interface LoopSection {
	/** Text after `|`, e.g. "Tune 2 ?". Empty when there is none. */
	name: string;
	start: number;
	/** Null when the line gives no end time. */
	end: number | null;
	/** The times as written, e.g. "2:18 - 4:34.3". */
	rangeText: string;
	/** Zero-based line within the block's contents. */
	line: number;
}

/**
 * Is this a label nobody has named yet? trad-split writes "Tune 1",
 * "Tune 2 ?" (a weak detection); a section can also have no label at all.
 */
export function isPlaceholderLabel(name: string): boolean {
	return /^(tune\s*\d+)?\s*\??$/i.test(name.trim());
}

/** A tune name made safe for a loops line, where `|` separates the label. */
export function cleanLabel(name: string): string {
	return name.replace(/[|\r\n]+/g, "/").trim();
}

/** The same section line with a new label, keeping the times exactly as written. */
export function setSectionLabel(line: string, name: string): string {
	const bar = line.indexOf("|");
	const times = bar >= 0 ? line.slice(0, bar).trimEnd() : line.trimEnd();
	return `${times} | ${cleanLabel(name)}`;
}

export interface LoopsBlock {
	file: string | null;
	/** Zero-based section from a `select:` line: the section the note is about. */
	select: number | null;
	sections: LoopSection[];
	errors: string[];
}

/** Accepts "M:SS", "M:SS.s", "H:MM:SS(.s)" or a plain number of seconds. */
export function parseTime(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const match = trimmed.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
	if (match) return parseInt(match[1] ?? "0", 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]);
	if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
	return parseFloat(trimmed);
}

/** "2:16.5" style: minutes and seconds, with tenths only when needed. */
export function formatTime(seconds: number): string {
	if (!isFinite(seconds) || seconds < 0) return "0:00";
	const tenths = Math.round(seconds * 10);
	const m = Math.floor(tenths / 600);
	const s = (tenths % 600) / 10;
	const whole = Math.floor(s);
	const frac = Math.round((s - whole) * 10);
	return `${m}:${String(whole).padStart(2, "0")}${frac ? `.${frac}` : ""}`;
}

export function parseLoopsBlock(source: string): LoopsBlock {
	const block: LoopsBlock = { file: null, select: null, sections: [], errors: [] };
	source.split("\n").forEach((raw, i) => {
		const line = raw.trim();
		if (!line) return;
		const fileMatch = line.match(/^file\s*:\s*(.+)$/i);
		if (fileMatch) {
			block.file = fileMatch[1].trim();
			return;
		}
		if (/^select\s*:/i.test(line)) {
			const selectMatch = line.match(/^select\s*:\s*(\d+)(?:\s+(once|loop|continue))?$/i);
			if (!selectMatch || parseInt(selectMatch[1], 10) < 1) {
				block.errors.push(`Line ${i + 1}: can't read "${line}"`);
				return;
			}
			block.select = parseInt(selectMatch[1], 10) - 1;
			return;
		}
		const match = line.match(/^([\d:.]+)\s*[-–—]\s*([\d:.]*)\s*(?:\|(.*))?$/);
		const start = match ? parseTime(match[1]) : null;
		const end = match && match[2] ? parseTime(match[2]) : null;
		if (!match || start === null || (match[2] && end === null)) {
			block.errors.push(`Line ${i + 1}: can't read "${line}"`);
			return;
		}
		if (end !== null && end <= start) {
			block.errors.push(`Line ${i + 1}: end is not after start`);
			return;
		}
		block.sections.push({
			name: (match[3] ?? "").trim(),
			start,
			end,
			rangeText: match[2] ? `${match[1]} - ${match[2]}` : `${match[1]} -`,
			line: i,
		});
	});
	if (block.select !== null && !block.sections[block.select]) {
		block.errors.push(`There is no section ${block.select + 1} to select`);
		block.select = null;
	}
	return block;
}

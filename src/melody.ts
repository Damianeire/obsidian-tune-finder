// Playing a tune's setting from the index, so a candidate can be checked by
// ear against the recording.
//
// The index has no ABC (it is stripped to save space), but each setting has
// FolkFriend's contour: one character per quaver, repeats written out, so
// a held note is the same character several times. That is enough to hear
// the melody; the rhythm within a beat (dotted notes, triplets, rolls) is
// lost.

import { CONTOUR_CHARS } from "./search.ts";

const MIDI_LOW = 48;

export interface MelodyNote {
	midi: number;
	/** Seconds from the start. */
	start: number;
	/** Seconds. */
	duration: number;
}

/**
 * Quavers a second for each dance type: a steady practice pace, a little
 * under session speed.
 */
const QUAVERS_PER_SECOND: Record<string, number> = {
	reel: 6.4,
	jig: 6,
	"slip jig": 6,
	slide: 7.5,
	polka: 4.6,
	hornpipe: 5,
	barndance: 5,
	strathspey: 4.4,
	march: 4.6,
	waltz: 4,
	mazurka: 4,
	"three-two": 5,
};

export function quaversPerSecond(dance: string): number {
	return QUAVERS_PER_SECOND[dance.toLowerCase()] ?? 5.5;
}

/**
 * A contour as notes. A run of the same pitch is one held note, since
 * that is how the contour writes a crotchet or a dotted crotchet (a
 * repeated quaver comes out held too). `transpose` moves every note.
 */
export function melodyNotes(contour: string, dance: string, transpose = 0): MelodyNote[] {
	const step = 1 / quaversPerSecond(dance);
	const out: MelodyNote[] = [];
	let i = 0;
	while (i < contour.length) {
		const ch = contour[i];
		let j = i + 1;
		while (j < contour.length && contour[j] === ch) j++;
		const index = CONTOUR_CHARS.indexOf(ch);
		if (index >= 0) out.push({ midi: MIDI_LOW + index + transpose, start: i * step, duration: (j - i) * step });
		i = j;
	}
	return out;
}

/**
 * One setting's contour, read from the index's JSON text without parsing
 * the whole 17 MB of it. Empty when the setting isn't there. Setting ids
 * are the only keys whose values are objects, so `"id":{` is unique.
 */
export function contourFromIndexJson(json: string, settingId: string): string {
	const at = json.search(new RegExp(`"${settingId.replace(/\D/g, "")}"\\s*:\\s*\\{`));
	if (at < 0) return "";
	const end = json.indexOf("}", at);
	const m = /"contour"\s*:\s*"([^"]*)"/.exec(json.slice(at, end < 0 ? undefined : end));
	return m ? m[1] : "";
}

/** Plays a melody with a soft synthesised voice. One at a time. */
export class MelodyPlayer {
	private ctx: AudioContext | null = null;
	private out: GainNode | null = null;
	private timer: number | null = null;
	private onEnd: (() => void) | null = null;

	/** Play these notes, stopping anything already playing. `onEnd` runs when they finish or are stopped. */
	play(notes: MelodyNote[], onEnd: () => void): void {
		this.stop();
		if (notes.length === 0) {
			onEnd();
			return;
		}
		this.ctx ??= new AudioContext();
		void this.ctx.resume();
		const ctx = this.ctx;
		const out = ctx.createGain();
		out.gain.value = 0.18;
		const filter = ctx.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = 2400;
		out.connect(filter).connect(ctx.destination);
		const t0 = ctx.currentTime + 0.05;
		for (const n of notes) {
			const start = t0 + n.start;
			const end = start + n.duration;
			const osc = ctx.createOscillator();
			osc.type = "triangle";
			osc.frequency.value = 440 * Math.pow(2, (n.midi - 69) / 12);
			const env = ctx.createGain();
			env.gain.setValueAtTime(0, start);
			env.gain.linearRampToValueAtTime(1, start + 0.012);
			env.gain.setValueAtTime(1, Math.max(start + 0.012, end - 0.03));
			env.gain.linearRampToValueAtTime(0, end - 0.005);
			osc.connect(env).connect(out);
			osc.start(start);
			osc.stop(end);
		}
		this.out = out;
		this.onEnd = onEnd;
		const last = notes[notes.length - 1];
		this.timer = window.setTimeout(() => this.stop(), (last.start + last.duration + 0.15) * 1000);
	}

	stop(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		if (this.out && this.ctx) {
			// Fade out quickly rather than click; the scheduled oscillators go with the node.
			const now = this.ctx.currentTime;
			this.out.gain.setTargetAtTime(0, now, 0.01);
			const out = this.out;
			window.setTimeout(() => out.disconnect(), 100);
		}
		this.out = null;
		const onEnd = this.onEnd;
		this.onEnd = null;
		onEnd?.();
	}

	dispose(): void {
		this.stop();
		void this.ctx?.close();
		this.ctx = null;
	}
}

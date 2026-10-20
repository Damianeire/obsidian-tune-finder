// Decoding vault audio for the engine: whole file to 48 kHz, then mono
// slices. Web Audio only runs on the main thread, so this happens here and
// the slices are handed to the worker.
import type { App, TFile } from "obsidian";

/** FolkFriend's default rate. Any rate from 4 to 66 kHz works; this is what it was tuned on. */
export const SAMPLE_RATE = 48000;

/**
 * Decoding holds the whole file in memory (about 23 MB a minute for
 * stereo at 48 kHz), so very long recordings are refused: over 15 minutes
 * on a computer, over 8 on a phone or tablet. Split session recordings into
 * sets first, for example with trad-split.
 */
export function maxDecodeSeconds(isMobile: boolean): number {
	return (isMobile ? 8 : 15) * 60;
}

/** Duration in seconds from the file's metadata, without decoding it. */
export function audioDuration(app: App, file: TFile): Promise<number | null> {
	return new Promise((resolve) => {
		const audio = new Audio();
		const done = (value: number | null) => {
			window.clearTimeout(timer);
			audio.removeAttribute("src");
			audio.load();
			resolve(value);
		};
		const timer = window.setTimeout(() => done(null), 10000);
		audio.preload = "metadata";
		audio.onloadedmetadata = () => done(isFinite(audio.duration) ? audio.duration : null);
		audio.onerror = () => done(null);
		audio.src = app.vault.getResourcePath(file);
	});
}

export async function decodeAudioFile(app: App, file: TFile): Promise<AudioBuffer> {
	const data = await app.vault.readBinary(file);
	// An OfflineAudioContext resamples what it decodes to its own rate.
	const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
	return await ctx.decodeAudioData(data);
}

/** Mono samples between two times (seconds), averaging the channels. */
export function monoSlice(buffer: AudioBuffer, start: number, end: number): Float32Array {
	const from = Math.max(0, Math.floor(start * buffer.sampleRate));
	const to = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
	const out = new Float32Array(Math.max(0, to - from));
	const channels = buffer.numberOfChannels;
	for (let c = 0; c < channels; c++) {
		const data = buffer.getChannelData(c);
		for (let i = 0; i < out.length; i++) out[i] += data[from + i] / channels;
	}
	return out;
}

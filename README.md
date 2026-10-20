# Tune Finder (Obsidian plugin)

Identifies traditional tunes in audio recordings in your vault, in the same way as [FolkFriend](https://folkfriend.app), Tunepal and similar apps. It listens to a recording, transcribes the melody, and searches the tune collection of [thesession.org](https://thesession.org) for the closest match.

It works one tune at a time. A recording with a `loops` block (from trad-split's "Add loops", or typed by hand for the Audio Loop Player) has each section identified separately, which is far more reliable than identifying a whole set at once.

## Use

- **Identify tunes in this note** (command palette, or the note's file menu): finds every audio embed in the note.
  - With a `loops` block under it, each section is identified separately. With a `select:` line, only that section is.
  - Without one, a short recording is treated as a single tune. A recording over a minute and a half is scanned for tune changes first (see below).
- **Identify tune in an audio file** (command palette, or right-click an audio file): one recording, with the result inserted at the cursor or copied.
- **Fill in missing tune types and keys** (command palette): suggests `type` and `key` for tune notes that lack them (see below).

The results window lists the best candidates for each tune or section:
- dance type, key, how well it matched, and a link to the tune on thesession.org;
- a **Likely**, **Possible** or **Unsure** label;
- **in vault** when you already have a note for that tune (matched by any of the tune's names, or the note's aliases);
- a ▶ button that plays the section, so you can check by ear.

Pick a candidate for each section, or "None of these", then **Add to note**. Two things can happen, each with a tick box in the window (and in Settings):

- **Name loop sections**: the picks are written into sections still called "Tune 1", "Tune 2 ?" and so on, which is what trad-split's Export tunes needs. A section you have named yourself is never changed.
- **Add a list with links**: an "Identified tunes:" list goes under the loops block (or the embed), with type, key and a link to the tune's setting on thesession.org.

````
![[Joshua Dukes - Lucy FarrsHills of Tara.mp3]]
```loops
file: Sound files/Joshua Dukes - Lucy FarrsHills of Tara.mp3
0:00 - 2:16.5 | Lucy Farr's
2:16.5 - 4:39.4 | Hill of Tara
```
Identified tunes:
- 0:00 - 2:16.5: Lucy Farr's, Barndance, G ([thesession](https://thesession.org/tunes/...))
- 2:16.5 - 4:39.4: [[Hill of Tara]], Barndance, G ([thesession](https://thesession.org/tunes/...))
````

A name is the tune's note in your vault when there is one, so links and Export tunes find it. Running it again replaces the list instead of adding another. Keys and dance types are written the way the vault's `key` and `type` properties are ("D", "A min", "E dor", "Slip Jig").

### Long recordings without loops

A recording longer than a minute and a half with no loops block may hold a whole set. Tune Finder identifies overlapping 30-second windows along it, ten seconds apart, then works out where the tune changes. It picks one tune per window, weighing each window's match against a penalty for every change, so one odd window or a bar of chat doesn't split a tune. Each tune found gets its own row in the window. **Add to note** writes a loops block for them under the embed, named with your picks, just as trad-split's Add loops would but with names. The boundaries are within about ten seconds; adjust them in the player if you need to. trad-split finds boundaries more precisely, so for session recordings, Add loops first and identify afterwards.

Tested on 20 recordings that already have loops blocks (session sets split by trad-split, and sets from YouTube), the scan found 32 of the 37 tune changes in those blocks, on average 4 seconds from where the block has them, and named 12 of the 14 sections with known names correctly. It also found 15 changes the blocks don't have. Most of these fall inside trad-split sections over three minutes long, which may well hold two tunes. Scanning takes about a second for every 11 seconds of music.

Turn this off in Settings ("Find tune changes in long recordings") to treat long recordings as one tune.

### Filling in types and keys

**Fill in missing tune types and keys** looks at every note in the tune folder with an empty `type` or `key`. It suggests values in this order:
1. **The note's own recording.** It identifies the stretch that is the note's tune: the `select:` section, a section labelled with the note's name, or a recording with no loops. If a match has the note's name, the type and key come from it, and the key is the one you actually play it in. A recording that isn't at concert pitch can't vouch for the key, so then the key is thesession.org's usual one.
2. **The name.** If only one tune on thesession.org has the note's name (or an alias), its usual type and key: the most common across its settings.
3. **A shared name.** If several tunes have the name, only what they all agree on is suggested, and it is left unticked.

Nothing is written until you tick the notes and press **Fill in ticked notes**, and only empty fields are filled.

Tested on the 301 tune notes in a practice vault that already had both, pretending they were empty: 93% of suggested types and 86% of suggested keys matched what was there. From the note's own recording, it was 98% and 90%. Most of the disagreements are distinctions thesession.org doesn't make (Single Reel and Reel, Barndance and Hornpipe) or keys with two readings (A minor and A dorian).

## How it works

1. The recording is decoded with Web Audio, and the stretch to analyse is cut out. By default that is the first minute of each section; see Settings.
2. FolkFriend's engine, compiled to WebAssembly and running in a background worker, transcribes the melody into a sequence of notes.
3. The notes are searched against FolkFriend's index of about 55,000 settings of 23,000 tunes from thesession.org: an n-gram shortlist, then a closer alignment of the best 2,000.
4. Two corrections FolkFriend itself doesn't make:
   - **Octave.** Tenor banjo and other low instruments come out an octave below the index, and so never matched. The transcription is moved to the octave the index uses.
   - **Pitch.** When the result is weak, the search is repeated a semitone and a tone up and down, and an octave either way. This catches recordings off concert pitch, or a tune played in a different key. A transposed result only wins if it is clearly better, and the window says when it was used.

The tune index (35 MB) is downloaded from FolkFriend's server the first time, then kept in the app's IndexedDB storage, not in the vault, so iCloud doesn't sync it. It refreshes itself when it is four weeks old, or use **Update the tune index**. Apart from that download, everything runs on your device. Nothing is uploaded.

## Accuracy

Measured with `eval/run.mjs` against 147 labelled recordings in a real practice vault (session recordings, YouTube downloads, banjo and concertina):

| Seconds analysed | FolkFriend's own search | Tune Finder |
|---|---|---|
| 30 | 57% | 78% |
| 45 | 59% | 81% |
| 60 (default) | 59% | 86% |
| Whole recording | 58% | 81% |

The figures are how often the first answer is the right tune.

They are slightly pessimistic: a few "wrong" answers were the right tune under another name ("Mick Finn's" is also "The Killavil"). When the label says Likely, the top answer was right 96% of the time, and four in five recordings got that label. Most failures are tunes that aren't on thesession.org, slow airs, songs, or recordings with heavy accompaniment. The engine follows a single melody line, so solo or unison playing works best.

## Settings

- **Seconds to analyse**: how much of each tune or section to listen to, from its start (default 60). Longer rarely helps; 0 listens to all of it.
- **Candidates to show**: 3, 5 or 10.
- **Tune notes folder**: where your tune notes live, for linking matches and for filling in types and keys (default `Trad Tunes`; empty means the whole vault).
- **Name loop sections**, **Add a list of identified tunes**: what Add to note does (both on by default).
- **Find tune changes in long recordings**: scan long recordings without loops (on by default).

## Limits

- Recordings over 15 minutes (8 on a phone or tablet) are refused, because decoding holds the whole file in memory. Split session recordings into sets first.
- Not yet tried on a phone or tablet. Nothing in it is desktop-only, but the engine and index take about 100 MB of memory while in use (50 MB of it WebAssembly), and decoding a long recording more. The worker is stopped after five idle minutes.

## Building

Needs Node 22.6+ (TypeScript tests run natively), Rust and wasm-pack (`brew install rustup wasm-pack`, then `rustup default stable` and `rustup target add wasm32-unknown-unknown`).

```sh
npm install
npm run engine   # builds engine/pkg (the WebAssembly)
npm run build    # type-checks and bundles main.js
npm test         # unit tests
```

Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/tune-finder/`.

To measure accuracy on your own recordings (they are only read, never copied):

```sh
node eval/run.mjs --dir "<vault>/Sound files" --notes "<vault>/Trad Tunes" --durations 30,60
node eval/session.mjs "<vault>/Sessions/<session>/<session>.md" "<vault>"
node eval/scan.mjs "<vault>"      # tune changes found by scanning, against existing loops blocks
node eval/details.mjs "<vault>"   # type/key suggestions, against notes that already have them
```

`harness/` runs the engine worker in a browser for testing outside Obsidian.

## Credits and licence

- Transcription and search: [FolkFriend](https://github.com/TomWyllie/folkfriend) by Tom Wyllie. Its engine is vendored, unchanged, in `engine/folkfriend` (see the README there).
- Tune data: [thesession.org](https://thesession.org), through FolkFriend's index.

Because it includes FolkFriend, Tune Finder is licensed under the GNU GPL v3 (`LICENSE`).

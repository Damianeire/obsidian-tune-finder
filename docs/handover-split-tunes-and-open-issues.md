# Handover: finish the split-tune work and pick up the open Tune Finder issues

Prepared 15 November 2026 from a trad-split session, for a Claude Code session in `~/Developer/obsidian-tune-finder`. Read the vault's `CLAUDE.md` first. Vault: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Trad Tunes Vault` (iCloud, no git).

## 1. Where things stand

**The repo has finished but unshipped work.** On `main`, uncommitted (from the session "Audio splitter improvements", 15 Nov):

| File | Change |
|---|---|
| `src/format.ts`, `src/identify-modal.ts`, `styles.css` | Join split tunes: when a section's pick is the same tune as the section before, the results window offers "Same tune as the section before (name). Join the two sections". On Add to note the two `loops` lines become one and the tune is listed once |
| `src/vault-match.ts`, `src/main.ts` | Vault links: a note whose `session:` property links to the matched tune wins; a note whose `session:` is a different tune is never matched by name |
| `tests/format.test.ts`, `tests/search.test.ts`, `README.md` | Tests (54 passing then) and a "Tunes split in two" README section |

`docs/handover-section-with-two-tunes.md` is also untracked (an older handover, see section 4).

**None of it is in the vault.** `<vault>/.obsidian/plugins/tune-finder/main.js` is the 3 October build. The repo's `main.js` (15 Nov) has the join feature; the vault's does not. This is why Damian reports that Castlekelly and McDonagh's Reel are still split.

**First steps:**

1. `npm test` and `npm run build`; check both pass.
2. Commit on a branch, open a PR (Damian merges via GitHub; explain each git step, he is learning).
3. Copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/tune-finder/`, then ask Damian to reload the plugin.
4. Run it on `Sessions/20261114 The Clock Tavern 19/20261114 The Clock Tavern 19.md` and check on screen that the join tick box appears for Sets 13 and 14. Nobody has seen it in Obsidian yet.

## 2. What trad-split now does (no need to change Tune Finder for this)

trad-split keeps weak tune changes (strength 0.15 to 0.4, marked `Tune N ?`). On 15 Nov it gained one exception, on branch `tune-chroma-chunks` in `~/Code/trad-split`: a weak change is dropped when less than the shortest-tune setting (60 s) is left before the end of the set. On the 14 Nov Clock Tavern session that removes exactly the two false cuts at 4:58 in Sets 13 and 14 and nothing else.

That only helps future splits. Tune Finder's join is still needed for:

- the existing note (Sets 13 and 14 are still two sections each);
- strong false cuts trad-split can't tell from real ones: 14 Nov Set 5 at 6:25.5 (Bag of Spuds on both sides, strength 0.32);
- weak false cuts away from the end: Clock Tavern 21 Set 1 at 5:45, and Clock Tavern 22 Set 2 at 2:05.5.

## 3. Cleaning up the 14 Nov session after the join

Joining the sections in the note does not undo what Export tunes already made. Already in the vault:

- `Attachments/20261114 McDonagh's Reel.mp3` and `... (2).mp3`
- `Attachments/20261114 Castlekelly.mp3` and `... (2).mp3`
- two `## Recordings` lines in each of `Trad Tunes/McDonagh's Reel.md` and `Trad Tunes/Castlekelly.md`

Export tunes skips an existing mp3 unless `--force`, so after the join the first mp3 stays short. Either a trad-split session does this cleanup, or Tune Finder's join notice should tell Damian to (delete the `(2)` files and links, re-export with force). Ask Damian before deleting anything; prefer moving to `.trash`.

Also: other notes with a `loops` block for the same recording are not updated by the join (the notice says so). Every `loops` block for a recording must list the same sections.

## 4. Open issues, roughly in priority order

From the 15 Nov investigation of the 14 Nov Clock Tavern session (engine run over all 15 sets in 30 s windows) unless noted.

1. **Listen elsewhere when the start is Unsure.** Only the first 60 s of a section is analysed. 14 Nov Set 2's "Tune 1" scores 0.13 there but 0.49 for Eel in the Sink from 0:50 (the cut at 1:09 is the tune's opening, so it should be joined). Set 5's "Tune 5 ?" scores 0.28 at its start and 0.55 near its end. Retrying from the end of the section, then applying the join check, would catch both.
2. **Scan long unnamed sections for a second tune.** 14 Nov Set 13's `0:00 - 3:51 | Tune 1` likely holds two tunes: a weak Crowley's match from 0:50 to 2:10, and McDonagh's appears to start about 2:15, not 3:49. Needs a listen. The same problem is in `docs/handover-section-with-two-tunes.md` (Seamus Hawkshaw Set 2, three tunes in two sections; and Set 1 "Kitty Lie Over" 1:43 to 5:50.5, where The Maid on the Green is heard after 3:46). Option 4 of that handover was chosen; check what was built for it before starting.
3. **Review the vault-link change before shipping it widely.** It changes 181 links across the index. Most are intended, but some suggest a `session:` property in the vault points at the wrong tune: tune 202 "Jenny Picking Cockles" no longer links to the note of that name, and tune 87 "Rolling in the Ryegrass" now links to "Shannon Breeze". Give Damian the full list to check; do not edit tune notes without asking.
4. **Loosen "Possible".** The Killavil jig scored 75% but was only Possible because the runner-up was close.
5. **Say when nothing resembles a tune.** 14 Nov Set 10 and the first 4:40 of Set 6 match nothing (all under 0.25): probably songs, airs or tunes not on thesession. A plain message beats a list of nonsense candidates.
6. **Oddity:** 14 Nov Set 3's "Tune 3 ?" comes out Likely, Bill Harte's (58%), yet is still unnamed in the note. Find out why it was not written.
7. **Same-name tunes** (raised 4 Oct in trad-split): "Hughie Travers'" is two different tunes, in G and in A dor. Damian named his notes with the key ("Hughie Travers' in G"), which doesn't match thesession. Vault matching by `session:` (item 3) is the main defence; check both notes have it.

## 5. Not Tune Finder, but in this repo's sessions

The Fetch Session Dots / Fetch Session ABC template (vault `Templates/`, a copy in this repo) was changed on 15 Nov to let Damian choose between same-named tunes and to fill an empty `first phrase` with the first two bars. Not tried in Obsidian. That session said it copied the template "to the repo", but on 15 Nov no template file showed in this repo's `git status`, so find where that copy went and confirm with Damian.

## 6. How to check things

- Tests: `npm test`. Build: `npm run build`.
- `node eval/session.mjs "<vault>/Sessions/<session>/<session>.md" "<vault>"` runs identification over a session note, read-only.
- `node eval/scan.mjs "<vault>"` compares scanned tune changes with existing `loops` blocks.
- Work on a copy of a session note before letting anything write to the real one.

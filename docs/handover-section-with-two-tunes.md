# Handover: a loops section that holds two tunes

Prepared 4 October 2026 from a trad-split session, for a Claude Code session in `~/Developer/obsidian-tune-finder`. Investigation only; nothing below is built.

## 1. The problem

`Sessions/20261003 Seamus Hawkshaw Meats/03 Set 2.m4a` (6:56 long) has three tunes, but its `loops` block has two sections:

```loops
file: Sessions/20261003 Seamus Hawkshaw Meats/03 Set 2.m4a
0:00 - 2:31.5 | Lad O'Beirne's
2:31.5 - 6:55.5 | Tune 2
```

Tune Finder names the first (Lad O'Beirne's, Reel, G) but has a hard time with the second, which is really tune 2 followed by tune 3. Damian thinks the third tune in the same section is why.

Vault: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Trad Tunes Vault` (iCloud, no git). Read its `CLAUDE.md` first. A copy of the session note for testing is at `Sessions/20261003 Seamus Hawkshaw Meats 1/` (Damian made it to test Export tunes, so it has already been exported once).

## 2. What we found

**trad-split's detector nearly found the change.** Running `trad_split.tunes.find_changes` on that file:

| Sensitivity | Changes |
|---|---|
| 1.0 (default) | 2:31.5 (strength 0.56) |
| 1.5 | 2:31.5, 5:00.5 (0.21) |
| no threshold | 2:31.5, 3:52 (0.09), 5:00.5 (0.21) |

The cut-off is 0.25, so the 5:00.5 change (0.21) was dropped. Likely layout: tune 2 from 2:31.5 to about 5:00.5 (2½ minutes), tune 3 from 5:00.5 to the end (about 2 minutes). Confirm by ear before relying on it.

**Tune Finder only hears the start of each section.** `analysisWindow` in `src/note-scan.ts` takes the first `analyseSeconds` (default 60) of a section. For 2:31.5 to 6:55.5 that is 2:31.5 to 3:31.5, which should be tune 2 alone if the change is at 5:00.5. So the third tune may not be what confuses it. Possible causes to check:

- tune 2 is played loosely, or is not in thesession's collection in this form;
- the first round of tune 2 is not a clean start (a lead-in, or the end of Lad O'Beirne's spilling over 2:31.5);
- 60 seconds is not enough for this tune.

**Scanning for changes only happens without a `loops` block.** `scan.ts` (overlapping windows plus Viterbi smoothing) runs on long embeds that have no `loops` block. A section in an existing block is never scanned, however long it is.

## 3. Options

In Tune Finder (this repo):

1. **Scan long sections.** When a section is much longer than one tune (say over 3½ minutes, or twice `analyseSeconds` plus some), run the scan inside it. If the scan agrees on a change, offer to split the section in the results window ("This section looks like two tunes: split at 5:00?"). Names would follow as now: only `Tune N` sections are renamed.
2. **Try another part of the section.** In the results window, let Damian re-identify a section from a later start, or with a longer window, when the first answer is Unsure. This is cheap, and also helps when the start of a section is messy.
3. Both: scan to suggest a split, and offer a retry for any Unsure row.

In trad-split (`~/Code/trad-split`, a separate session; not for this repo):

4. Write weak changes (strength between about 0.15 and 0.25) into the `loops` block as a section marked ` ?` ("Tune 3 ?") instead of dropping them. Tune Finder and Damian then see a likely boundary. The detector is `trad_split/tunes.py`, called from `trad_split/cli.py` (splitting) and `trad_split/loops.py` (Add loops).

The choice between them is Damian's. Option 1 matches what Tune Finder already does for whole recordings and needs no change in trad-split.

## 4. Testing

- On the copy of the session note: identify tunes, and check whether the second section is split (option 1) or can be retried (option 2), and that the result names tunes 2 and 3 correctly. Check by ear with ▶.
- Make sure a normal-length section is not split, for example on the other sessions in `Sessions/` (20261003 The Clock Tavern 19 has 12 sets with Tune Finder lists already written).
- Keep `tests/` and `eval/` passing; add a case for a section holding two tunes if the eval set allows it.

## 5. Things to know

- Change the TypeScript here, build, then copy `main.js`, `manifest.json`, `styles.css` into the vault's `.obsidian/plugins/tune-finder/`. Never patch the built `main.js` in the vault.
- Use `git --no-optional-locks` for read-only git commands, or an empty `.git/index.lock` blocks Damian's next commit. Commit, but do not push; Damian pushes. This repo has no remote yet.
- Every `loops` block for the same audio file should list the same sections, or the Audio Loop Player reports that they differ. If a split is written into the session note, tune notes with a block for that file (for example `Trad Tunes/Lad O'Beirne's.md` may get one) need the same split, or should be listed for Damian.
- Plain Irish/UK English in UI text, no em dashes.
- Back to trad-split afterwards: the open items there are live tests of Export tunes (Use existing and Cancel on a copy of `20261003 The Clock Tavern 19`) and Fetch Session Dots on a note with a `session:` link.

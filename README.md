# Scale Practice

A free web page that helps students practise scales and arpeggios on the **violin, viola, cello and double bass**.

- Choose the exercise: major and minor scales (natural, harmonic or melodic), arpeggios, chromatic scales, dominant and diminished 7ths, double stops (broken or together), double-bass scales in broken and running thirds, thumb-position scales, and double-bass ranges to a 6th or 12th.
- Choose 1–3 octaves, a rhythm for each note, long notes at the ends, a repeated top note, and slurs.
- Show only the name, the key signature, or the full score.
- **The microphone listens.** A tuner bar shows how sharp or flat each note is, and an arrow follows the student through the score. At the end you get a score: intonation counts for 75 % and timing for 25 %. Extra notes cost points, and missing notes score zero.
- A precision slider runs from Beginner to Expert, and there's an option for players using vibrato.
- **My list:** students save the exercises they are working on, see their last and best scores, and hide every other option. A teacher can send a list as a link.
- **Tuner page:** tune the open strings in equal temperament or with pure fifths (pure fourths on the bass), with reference tones.
- Light and dark modes.

**Privacy:** everything runs in the browser. No sound, scores or settings are sent anywhere. Lists and scores are saved only in that browser on that device. Use *Export* / *Import* to move a list to another device.

---

## Publishing it free on GitHub Pages

GitHub Pages is free for **public** repositories. It also serves the page over **https**, which browsers require before they will allow microphone access.

### Option A – using the GitHub website (no tools needed)

1. Sign in at <https://github.com> and click **New repository**. Give it a name, for example `scale-practice`, and choose **Public**. Click **Create repository**.
2. On the new repository page, click **uploading an existing file**. Drag in **everything inside this folder**, including the `css`, `js`, `vendor` and `tests` folders and the empty `.nojekyll` file. Your file browser may hide `.nojekyll`; show hidden files to see it. Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then the **main** branch and the **/(root)** folder. Click **Save**.
4. After a minute or two, the page is live at `https://<your-user-name>.github.io/scale-practice/`.

### Option B – using git on the command line

```bash
git remote add origin https://github.com/<your-user-name>/scale-practice.git
git push -u origin main
```

Then turn on Pages as in step 3 above.

To update the site later, change the files and push again, or upload them again on the website.

## Trying it on your own computer

Opening `index.html` directly from disk (`file://`) won't work, because browsers block modules and the microphone. Start a small local web server in this folder instead:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. The microphone is allowed on `localhost`.

## Checking that it works

- **Automatic tests:** open `tests/` on the site, for example <http://localhost:8000/tests/>. They check scale spelling, pitch detection (including low double-bass notes), note detection, scoring and the practice list. They use synthetic sound, so no microphone is needed.
- **Test mode:** add `?debug=synth` to the address, for example <http://localhost:8000/?debug=synth>. A panel appears that plays a synthetic "student" instead of using the microphone. You can make that student play out of tune, unevenly, with vibrato, or with missing or extra notes, then watch the arrow, the tuner bar and the summary. In test mode the synthetic player ignores the metronome, so timing is only meaningful with the metronome off.
- **With a real instrument:** please try every instrument on the devices your students use, especially phones with cello and double bass, because small microphones pick up low notes poorly. The detection thresholds are named constants at the top of `js/segmenter.js` (`SEG`), `js/pitch.js`, `js/practice.js` (`RUN`), `js/scoring.js` (`SCORING`) and `js/precision.js` (the precision levels). They can be adjusted after testing.

## Changing things

| To change… | Edit |
|---|---|
| Instrument ranges, starting notes, clef-change points | `js/instruments.js` |
| Which exercise types, ranges and slur groupings are offered | `js/exercises.js` (`EXERCISE_TYPES`) |
| Rhythm patterns | `js/sequence.js` (`RHYTHMS`) |
| Precision levels (Beginner…Expert) | `js/precision.js` (`LEVELS`) |
| Score weighting and the extra-note penalty | `js/scoring.js` (`SCORING`) |
| Colours and layout | `css/styles.css` |

## How it works (short version)

1. The microphone feeds an AudioWorklet. With echo cancellation, noise suppression and auto-gain turned off, a Web Worker runs the **McLeod pitch method** on overlapping windows of up to 85 ms, about 90 times a second.
2. A noise floor is measured during the first moment after **Start**. Quiet frames, unclear (noisy) frames and frames outside the instrument's range are ignored.
3. Notes are found in two ways: when the **pitch changes**, which handles slurs, and when the **level dips briefly**, which handles bow changes and repeated notes. Notes shorter than 70 ms, such as shifts and scratches, are discarded. A note's pitch is measured over its steady middle.
4. When you finish, the notes you played are **aligned** with the expected notes. Unmatched notes count as extra, gaps count as missing, and notes more than 50 cents out count as wrong. Then the notes are scored. Timing is measured against your own pulse, or against the metronome when it is on.
5. Double stops played together are measured from spectrum peaks. Octave double stops can only be measured approximately, and the summary says so.

Music notation is drawn with [VexFlow](https://www.vexflow.com) (MIT licence, included in `vendor/`).

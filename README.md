# Scale Practice

A free web page that helps students practise scales and arpeggios on the **violin, viola, cello and double bass**, on **any other instrument**, or **sung to sol-fa**.

- **Voice:** on the Tuner page the singer holds their lowest and highest comfortable notes for two seconds each. Notes that waver or come through strained are refused, so the range is realistic. The range gives a traditional voice type (female names where a range fits both), the clef (tenors read treble clef an octave up) and where each exercise sits. Notes are sung to Do Re Mi: movable Do (minor keys on Do or on La) or fixed Do. Syllables appear under the score and in the summary. Listening allows for consonants, scoops into notes and vibrato, and the pitch and timing tolerances are wider than for strings. The voice type can also be chosen by hand.
- **Other instrument:** name it, choose its lowest and highest written notes from drop-downs, and set its transposition (up an octave to down an octave and a 6th; for example B♭ clarinet sounds a tone lower). The clef is chosen from the range or set by hand. Calibration uses two long notes and warns if the transposition looks wrong. The highest note is always at least an octave above the lowest. The instrument's setup is saved with each syllabus item and goes with a shared syllabus link, so a teacher can send exercises for a B♭ clarinet. Changing the setup makes it a different exercise, so its results are kept apart.

- Choose the exercise: major and minor scales (natural, harmonic or melodic), arpeggios, chromatic scales, dominant and diminished 7ths, double stops (broken or together), double-bass scales in broken and running thirds, thumb-position scales, and double-bass ranges to a 6th or 12th.
- Tabs: **Practice**, **Config**, **Results**, **Tuner**, **Pieces** and **Games**. On very wide screens (1600 px and up) Practice and Config share one page. The layout is made for phones, including landscape: on a phone held sideways the Practice page's top is a single slim bar (Start, Play, ◀ ▶, the title, the status and ⋯); ⋯ drops the rest down over the music and it hides again on Play or Start, a tap on the music, or after 6 seconds untouched (`setMore` in `js/main.js`). While a piece is open, ◀ ▶ step through the pieces (in the Pieces list's order) instead of the syllabus.
- **Practice:** buttons across the top choose the rhythm for each note (crotchet, crotchets with long ends, long ends plus long key notes, 2 quavers, 2 quavers + crotchet, 2 quavers + rest, 4 quavers) and switch **Slurred** on or off. The tuner gauge sits on the left with the note name and cents underneath, and the score scrolls itself as you play.
- **Config:** student name; the **Syllabus** (the exercises being worked on) with Back / Next on the Practice page; exercise options (1–3 octaves, repeated top note, notes per bow when slurred); and display and listening options that apply to every exercise.
- Show only the name, the key signature, or the full score.
- **Play** performs the exercise in a synthesised violin, viola, cello or double-bass tone at the chosen tempo, with the arrow following along.
- **The microphone listens.** A tuner bar shows how sharp or flat each note is, and an arrow shows the note to play next: it moves on once the note being played has sounded for about its length (and moves along rests in time), so it points ahead rather than at the note just played. At the end you get a score: intonation counts for 75 % and timing for 25 %. Extra notes cost points – 3 each, but never more than a wrong note would, so in a long piece a stray note costs as much as one wrong one; in a piece, short blips (under 0.3 s at Beginner down to 0.06 s at Expert) aren't counted and slightly longer ones only in part – and missing notes score zero.
- A precision slider has five levels, Beginner to Expert, and there's an option for players using vibrato. Extra notes count as **errors**.
- **Benefit of the doubt:** before a note is called wrong, it is looked at more closely. If part of it is at the right pitch (a slide in, a stray reading), it is scored on that part and marked "re-checked". If it sits a harmonic away, it counts as the right note, measured after the shift and marked "heard an octave up" or similar. The harmonics allowed are an octave or two up, an octave down, or an octave and a fifth up or down; phone microphones often hear low open strings this way. Repeated notes that ran together or were chopped up are reshaped using the rhythm, and short slides between notes are treated as part of the next note.
- **Bow-change scrapes** (very short sounds between notes) also count as errors, weighted by how long and how loud they are compared with the note. They are free at Beginner and Elementary unless long and loud, and count in full at Expert. The summary says how many were heard and how much they counted. Errors are stored per precision level with each run, like the other scores. Singers' consonants are never counted.
- **Syllabus:** a teacher can send a syllabus as a link (scores are not included). Export / Import moves a syllabus and its results to another device.
- **Move to another device** (in Config): **Export everything** saves one file with the syllabus, results, pieces, settings, student name, voice range and other-instrument setup. On phones it opens the share sheet, so the file can be saved to Files, AirDropped or emailed. **Import everything** on the new device (or in the installed app) replaces what is there with the backup, after asking. Microphone calibrations stay with each device, because they describe that device's microphone, so calibrate again on the new one.
- **Results:** every run of a syllabus exercise is saved in the browser. The last 10 runs are kept in full; older runs keep their scores, which are averaged per day after a month and per month after a year. A piece not practised for 6 months keeps only its scores (`RES.pieceDetailDays` in `js/results.js`): its full runs, the largest part of the store, are cleared, and the page saves the smaller store when it opens. Every score is stored at all five precision levels, so the charts stay right when the slider changes. For each exercise there is a 3D surface of the last 10 runs (cents sharp or flat for each note, oldest at the back), every run of the last 2 weeks, daily averages for 6 months and monthly averages for all history; a summary shows one line per syllabus exercise (its daily average total, and monthly for all history).
- **Export PDF:** one tap makes a PDF of the results (summary plus every exercise) to send to the teacher, named with the student's name. More options let the student choose exercises, charts, and all history or just the past 2 weeks.
- **Tuner page:** tune the open strings in equal temperament or with pure fifths (pure fourths on the bass), with reference tones, and a **metronome** with beats per bar and tap tempo.
- **Microphone calibration** (on the Tuner page): after tuning, stay quiet for a few seconds and then bow each open string. The app learns how loud and how clearly this microphone hears the instrument in this room, and adjusts its listening to match. It also checks that the microphone hears true pitch: if every string reads shifted (by the microphone, or by a recording played back at the wrong speed), it warns you and corrects for it. Calibrations are kept per instrument, in this browser only.
- **Games** (the Games tab), with levels, stars and best scores per level; scoring 70% or more opens the next level:
  - **Name the note** (listening): a note is played in the chosen instrument's sound, and the student picks its name from four. Levels 1–2 give the key (level 1 plays it first); 3–4 play two notes in the key; 5–6 give no key, and the wrong answers are then a semitone or a tone away. An **Easier** switch (with its own scores and levels) plays the four choices first – each button lights up as it sounds, each in the octave closest to the note, and the key is not played as well – then the note; with two notes, the choices and the first note, then the choices and the second note.
  - **Sing the note**: the student sings the note named and holds it in tune for half a second (any octave counts). Level 1 plays the key and the note; levels 2–3 only name it (sol-fa plus letter), with the key played or shown; 4–6 ask for two or three notes in a row; 7 gives no key. The notes are placed in the singer's measured range.
- **Pieces** (the Pieces tab): any number of pieces saved on the device, practised on the Practice page with the arrow, tuner bar, Play and scoring (results charts are for syllabus exercises only). Pieces are written in a strict subset of ABC notation (`js/pieceText.js`): header T/C/M/L/Q/K (with `clef=`), notes and octaves, accidentals to the end of the bar, lengths, rests, bars, ties, slurs, triplets, broken rhythm, double stops, key/time changes mid-piece, and repeats (expanded; first/second-time endings are refused). The editor redraws the score as you type and lists mistakes by line. **Join two pieces** makes a new, editable piece of A then B.
  - **Decode music from a photo:** opens Claude in a new window (`claude.ai/new?q=…`) with the instructions filled in (`AI_PROMPT` in `js/pieces.js`); the student is advised to use Sonnet or Opus. Claude asks for a photo (a whole-piece repeat is written once), writes a short reading of each bar and then the music as ABC in a code block, and tells the student to copy it back; the app reads it and opens the editor, or makes a correction request for Claude. The app checks the answer for bars that don't add up and for music an octave or more away from its clef. Staccato dots (`.A`) and tenuto lines (`!tenuto!A`) are kept: under a slur they leave a short gap in the same bow when played. Fingering (`!0!A` … `!4!A`, `[!1!D!3!A]`) is copied exactly as printed and drawn above the notes; the instructions tell Claude to trust it (practice pieces often use unusual fingerings on purpose) and never to use it to decide a pitch. Only the top staff of each system is used, so music with piano or another accompaniment works; multi-instrument, orchestral and two-hand piano scores don't. The student does this step in Claude themselves so the app stays free (no AI service to pay for), and they take responsibility for any copyrighted music they decode this way. The web `?q=` link is not documented (Anthropic documents it for the desktop app's `claude://` links, where it is cut at about 14,000 characters); if it stops filling in the prompt, **Copy the instructions** is the fallback.
  - **Share:** each piece has a 🔗 Share link (`#piece=` + the name and text, base64url) to send in a message. Opening it adds the piece to the other person's pieces (not twice); **📥 Paste a shared link** does the same where a link opens in a different browser from the installed app (iPhone Home Screen). A warning under the link says not to use it to pass on copyrighted music. The piece stays in the link after `#`, which browsers don't send to the server.
  - **Tempo:** each piece has its own tempo, separate from the scales' tempo in Config. The written tempo is the piece's `Q:` line (a **Tempo** field in the editor sets it). On the Practice page **−** / **+** (5 % of the written tempo each) or a typed number set the practice tempo, kept per piece (`prefs.pieceTempos`); Play, the metronome and listening follow it. Playing slower than written reduces the total (`tempoFactor` in `js/scoring.js`, settings in `SCORING.slowTempo`): on a log scale, 20 % off at half speed and almost nothing just under (95 % of the speed costs 0.4 %, 90 % 1.2 %, 75 % 5.3 %); faster costs nothing. The tempo played is the metronome's, or measured from the notes (the practice tempo if fewer than 4 notes were heard). Each run keeps the practice tempo, the written tempo, the tempo played and the reduction; the Results table and PDF show them.
  - **Fingering and position changes:** ✏ Fingering on the Practice page, then tap a note to set its finger (0–4), remove it, or add a position-change mark – a light pencilled slash before the note, about 7.5° from upright, two spaces beyond the stave each side (`--score-pencil`). The change is written straight into the piece's text (`!2!`, `!shift!`), found by where the note is written (`setFingering` / `setShift` in `js/pieces.js`).
  - **Sections and results:** ✂ Choose bars on the Practice page (drag across bars, or tap the first and last) practises just those bars: Play, listening and scoring use a section sequence (`sectionSequence` in `js/pieces.js`) whose notes map back to the full score. Every piece run is saved in the results store as `piece:<id>`, note by note across the whole piece (bars not played are left empty), with the bars played; pieces appear on the Results tab and in the PDF. During Play the arrow also moves along rests.
- **TV mode** (📺 TV on the Practice page): for mirroring the phone's screen to a TV. The score is drawn at a smaller scale (`scale` in `renderScore`, `js/notation.js`; the arrow and bar positions are scaled to match), set with a **Size** slider from 25 % to 100 % (`prefs.castPct`, 50 % to start). The text and tuner bar shrink too (`body.cast` in `css/styles.css`), but Start, Stop and Play stay at least 44 px tall. The phone's microphone still does the listening.
- **Help** (the **?** button at the top): plain instructions for students covering every feature. A link ending in `#help` opens it directly.
- After a run, the notes on how the sound was analysed (bow scrapes, notes heard at a harmonic, re-checked notes) are shown only in Test mode, so students see the plain result.
- Light and dark modes.

**Microphone:** by default the app opens the microphone when it starts, so the browser asks for permission once and **Start** begins straight away. The phone's microphone indicator stays on while the app is open. Sound is only analysed during a run, the tuner or calibration, and it is never recorded or sent anywhere. This can be switched off in Config → Listening; the microphone is then opened at each Start and closed afterwards. To stop the question appearing each time on iPhone in Safari, tap **aA** → **Website Settings** → **Microphone** → **Allow**. An app added to the iPhone home screen may still ask again after it has been closed.

**Screen stays on:** while the app is listening or making sound (a run, Play, the tuner, calibration, the metronome) and for 2 minutes afterwards, it asks the browser to keep the screen on (Screen Wake Lock), so the phone doesn't lock mid-scale. This works in iPhone Safari from iOS 16.4, in Home Screen apps from iOS 18.4, and in Chrome, Edge and on Android. Elsewhere it does nothing, and a longer Auto-Lock setting is the workaround.

**Keeping the data:** everything is in the browser's `localStorage` (about 5 MiB per origin, shared by every GitHub Pages project on the same `<user>.github.io`). Browsers may clear it under storage pressure, and Safari clears it after 7 days of Safari use without visiting the site (Home Screen apps have their own counter). After the first saved run the app calls `navigator.storage.persist()` (`js/persist.js`; at start-up in the installed app) to ask for it to be kept; the browser decides, and Config shows the answer with a button to ask again. Export everything remains the reliable copy.

**Privacy:** everything runs in the browser. No sound, scores or settings are sent anywhere. If visit counting is switched on (see below), only anonymous page loads are counted, with no cookies. Lists and scores are saved only in that browser on that device. Use *Export everything* / *Import everything* in Config to move to another device.

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

## Installing it as an app (phones, tablets, computers)

The site is an installable web app: it gets a home-screen icon, opens full-screen and works offline after the first visit.

- **Android, and Chrome or Edge on a computer:** tap **⬇ Install** at the top of the page, then **Install now**.
- **iPhone and iPad:** in Safari, tap **Share** → **Add to Home Screen** → **Add**. The **⬇** button shows these steps.
- **A link to send to students:** add `#install` to the address, for example `https://simm42.github.io/MusicalScales/#install`. It opens the page with the install steps showing.

When online, the app always loads the newest version. The copy for offline use is updated at the same time. If you add a new file to the app, add it to `APP_FILES` in `sw.js`; a test in `tests/` checks that nothing the app loads is missing from that list.

On iPhone and iPad the installed app keeps its own storage, separate from Safari, so use the export in Config to bring a syllabus and results across.

## Counting visits (optional, free)

The site can count anonymous page visits with **Cloudflare Web Analytics** (free, no cookies, no personal data, so no consent banner is needed):

1. Create a free account at <https://dash.cloudflare.com>, then open **Analytics & Logs → Web Analytics → Add a site**.
2. Enter the site's address without `https://`, for example `simm42.github.io`, and choose the JavaScript snippet option.
3. Copy the `token` value from the snippet (the long code after `"token": `).
4. Paste it between the quotes of `CLOUDFLARE_TOKEN` in `js/analytics.js` and publish.

The counter only loads on the live `github.io` site, never on a local copy or the test pages. While the token is empty, nothing is loaded. The privacy line at the bottom of the page changes automatically to say that anonymous visits are counted.

## Trying it on your own computer

Opening `index.html` directly from disk (`file://`) won't work, because browsers block modules and the microphone. Start a small local web server in this folder instead:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. The microphone is allowed on `localhost`. `python tools/serve.py 8000 .` does the same but tells the browser not to keep old copies of the files, which is handier while changing the code.

## Checking that it works

- **Automatic tests:** open `tests/` on the site, for example <http://localhost:8000/tests/>. They check scale spelling, pitch detection (including low double-bass notes), note detection, scoring and the practice list. They use synthetic sound, so no microphone is needed.
- **Test mode:** add `?debug=synth` to the address, for example <http://localhost:8000/?debug=synth>. A panel appears that plays a synthetic "student" instead of using the microphone. You can make that student play out of tune, unevenly, with vibrato, or with missing or extra notes, then watch the arrow, the tuner bar and the summary. In test mode the synthetic player ignores the metronome, so timing is only meaningful with the metronome off.
- **Recording what the microphone hears (fault-finding):** add `?debug=capture` to the address, for example `https://<your-user-name>.github.io/MusicalScales/?debug=capture`, and do a normal run. Afterwards a **Download recording** button appears. The `.wav` file holds exactly what the microphone heard, plus the exercise settings and the score it got. Put these files in the `debug-recordings` folder, then open `tests/replay.html` on a local server. It re-scores every recording with the current code and draws a pitch-and-loudness chart, so changes can be checked against real recordings. Recordings in that folder are never committed to git.
- **With a real instrument:** please try every instrument on the devices your students use, especially phones with cello and double bass, because small microphones pick up low notes poorly. The detection thresholds are named constants at the top of `js/segmenter.js` (`SEG`), `js/pitch.js`, `js/practice.js` (`RUN`), `js/scoring.js` (`SCORING`) and `js/precision.js` (the precision levels). They can be adjusted after testing.

## Changing things

| To change… | Edit |
|---|---|
| Instrument ranges, starting notes, clef-change points | `js/instruments.js` |
| Which exercise types, ranges and slur groupings are offered | `js/exercises.js` (`EXERCISE_TYPES`) |
| Rhythm patterns | `js/sequence.js` (`RHYTHMS`) |
| Precision levels (Beginner…Expert) | `js/precision.js` (`LEVELS`) |
| Score weighting, the extra-note penalty and the slow-tempo reduction for pieces | `js/scoring.js` (`SCORING`) |
| Colours and layout | `css/styles.css` |

## How it works (short version)

1. The microphone feeds an AudioWorklet. With echo cancellation, noise suppression and auto-gain turned off, a Web Worker runs the **McLeod pitch method** on overlapping windows of up to 85 ms, about 90 times a second.
2. A noise floor is measured during the first moment after **Start**. Quiet frames, unclear (noisy) frames and frames outside the instrument's range are ignored.
3. Notes are found in two ways: when the **pitch changes**, which handles slurs, and when the **level dips briefly**, which handles bow changes and repeated notes. Notes shorter than 70 ms, such as shifts and scratches, are discarded. A note's pitch is measured over its steady middle.
4. When you finish, the notes you played are **aligned** with the expected notes. Unmatched notes count as extra, gaps count as missing, and notes more than 50 cents out count as wrong. Then the notes are scored. Timing is measured against your own pulse, or against the metronome when it is on.
5. Double stops played together are measured from spectrum peaks. Octave double stops can only be measured approximately, and the summary says so.

Music notation is drawn with [VexFlow](https://www.vexflow.com) and PDFs are made with [jsPDF](https://github.com/parallax/jsPDF) (both MIT licence, included in `vendor/`).

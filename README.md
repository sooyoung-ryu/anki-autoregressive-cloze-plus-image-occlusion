# Autoregressive Cloze + Image Occlusion

Single Anki add-on package that creates and manages three note types:

1. `Autoregressive Cloze`
2. `Autoregressive Image Occlusion`
3. `Autoregressive Cloze + Image Occlusion`

The package is self-contained: note type creation, reviewer hooks, reveal order, and debugging all live in this repo.

## Reveal behavior

### 1. Autoregressive Cloze

Pressing the space bar reveals the current card's cloze blanks one by one, left-to-right.
When the last blank is revealed, the answer is shown immediately.

### 2. Autoregressive Image Occlusion

Pressing the space bar reveals the current card's image masks one by one.
Reveal order is top-to-bottom, then left-to-right, with `ordinal` respected first to match Anki's shape grouping.
When the last mask is revealed, the answer is shown immediately.

### 3. Autoregressive Cloze + Image Occlusion

This note type is built on top of Image Occulsion, with four extra text fields:

1. `Text Before`
2. `Cloze Before`
3. `Text After`
4. `Cloze After`

Reveal order on each space bar press:

1. `Cloze Before` blanks for the current card's cloze number, left-to-right
2. Image occlusion masks for the current card's cloze number, top-to-bottom then left-to-right
3. `Cloze After` blanks for the current card's cloze number, left-to-right

When the last item is revealed, the answer is shown immediately.

## Note type creation

On profile open, the add-on creates the three note types automatically if possible.

If the note types were not created automatically, run:

`Tools -> Setup 'Autoregressive Cloze + Image Occlusion' Note Types`

## Automatic debug dumps

For the three autoregressive note types, the add-on automatically writes reviewer dumps at:

1. question shown
2. every reveal step
3. immediately before the answer is shown

Dump files are stored in:

`/tmp/anki-arcio-dumps/cloze.json`
`/tmp/anki-arcio-dumps/image-occlusion.json`
`/tmp/anki-arcio-dumps/combined.json`

Each file always contains only the most recently visited card for that note type, so at most three card dumps exist at the same time.
The dump includes reveal state, rendered cloze spans, hidden image-occlusion masks, current IO setup config, and the question-side HTML snapshot.

## Important setup note

Anki only creates its stock Image Occlusion note type after you use Image Occlusion at least once.
If `Autoregressive Image Occlusion` or `Autoregressive Cloze + Image Occlusion` is missing, first create one stock Image Occlusion note in Anki, then run the setup action again.

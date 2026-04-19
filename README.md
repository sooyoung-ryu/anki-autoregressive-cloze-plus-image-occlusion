# Cloze + Image Occlusion

Combines cloze deletions and image occlusion in a single note, with autoregressive reveal on each spacebar press.

### Note type structure

A note has three sections displayed in order:

1. **Text1** — cloze text before the image
2. **Image** — an image with occlusion masks, edited with Anki's built-in Image Occlusion editor
3. **Text2** — cloze text after the image

### Cloze numbering

Cloze numbers in Text1, the image masks, and Text2 are aligned by number.
Card 1 tests all `{{c1::...}}` blanks in Text1, the `c1` mask group on the image, and all `{{c1::...}}` blanks in Text2.

### Reveal order

On each spacebar press, items are revealed in this order:

1. Text1 blanks for the current card's cloze number, left-to-right
2. Image masks for the current card's cloze number, top-to-bottom then left-to-right
3. Text2 blanks for the current card's cloze number, left-to-right

After the last item is revealed, the answer is shown automatically.

### Installation

**Step 1:** In Anki, create at least one Image Occlusion note (this initializes Anki's built-in IO note type).

**Step 2:** Install this add-on. The `Cloze + Image Occlusion` note type is created automatically on the next Anki startup.

If the note type was not created automatically, go to **Tools > Setup 'Cloze + Image Occlusion' Note Type**.
# Cloze + Image Occlusion

Combines cloze deletions and image occlusion in a single note, with autoregressive reveal on each spacebar press.

### Note type structure

A note has four text fields around the image:

1. **Text Before** — plain text above the image (no cloze processing; always visible)
2. **Cloze Before** — cloze text above the image (autoregressive reveal)
3. **Image** — an image with occlusion masks, edited with Anki's built-in Image Occlusion editor
4. **Text After** — plain text below the image (no cloze processing; always visible)
5. **Cloze After** — cloze text below the image (autoregressive reveal)

Any of the four text fields may be left empty.

### Cloze numbering

Cloze numbers in **Cloze Before**, the image masks, and **Cloze After** are aligned by number.
Card 1 tests all `{{c1::...}}` blanks in Cloze Before, the `c1` mask group on the image, and all `{{c1::...}}` blanks in Cloze After.

### Reveal order

On each spacebar press, items are revealed in this order:

1. **Cloze Before** blanks for the current card's cloze number, left-to-right
2. Image masks for the current card's cloze number, top-to-bottom then left-to-right
3. **Cloze After** blanks for the current card's cloze number, left-to-right

After the last item is revealed, the answer is shown automatically.

### Installation

**Step 1:** In Anki, create at least one Image Occlusion note (this initializes Anki's built-in IO note type).

**Step 2:** Install this add-on. The `Cloze + Image Occlusion` note type is created automatically on the next Anki startup.

If the note type was not created automatically, go to **Tools > Setup 'Cloze + Image Occlusion' Note Type**.
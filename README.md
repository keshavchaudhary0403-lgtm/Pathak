# Pathak (पाठक)

A free e-reader that runs in the browser. Live at https://pathak-woad.vercel.app

## Features
- Library for EPUB and PDF: import by button or drag and drop, covers, progress, continue reading
- EPUB reader: pages or scroll, swipe and arrow keys, contents, 4 page themes, 5 typefaces, size, spacing, margins, time left in chapter
- PDF reader: continuous scroll, zoom, outline, selectable text
- Highlight in 4 colours: every highlight is saved to Cards, with an optional note
- Dictionary: English meaning with Hindi word, and Hindi to English
- Cards: save important sentences, sections or words; search, notes, export, share as image
- PDF snip: drag over any part of a page (works on scanned PDFs) to save it as an image card
- Search inside a book (EPUB and PDF), with jump-to-result
- Read aloud with page following, paragraph highlight, speed control, Hindi and English voices
- Reading streak and minutes read
- Backup and restore, installable app with offline support

All data stays in the browser (IndexedDB). Only DRM-free files can be opened.

## Develop
```
npm install
npm run dev
```
Build with `npm run build`. Vercel builds with Vite and serves `dist/` (see `vercel.json`).

## Structure
- `index.html`: landing page
- `app.html`, `src/app/`: the reader app
- `public/`: icons, manifest, service worker, sample book

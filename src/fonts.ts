import { fileURLToPath } from 'node:url';

// Fonts bundled in assets/fonts so charts render the same on any host:
// DejaVu Sans covers Latin, Greek, Cyrillic and many symbols; Noto Emoji is a
// monochrome emoji font (resvg can't draw color emoji fonts). Both src/ and
// dist/ sit two levels below the repo root.
const FONT_DIR = new URL('../assets/fonts/', import.meta.url);

export const FONT_FILES = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'NotoEmoji-Regular.ttf'].map((f) =>
  fileURLToPath(new URL(f, FONT_DIR)),
);

/** font-family list for SVG text; system fonts (e.g. CJK) fill any gaps. */
export const FONT_FAMILY = "'DejaVu Sans', 'Noto Emoji', 'Noto Sans', 'Noto Sans CJK SC', sans-serif";

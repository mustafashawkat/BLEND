# Blend

The site for Blend, a Cairo agency: UGC video, ushers and events, and web pages.

Served by GitHub Pages from the default branch root. `index.html` is a single
standalone page; everything it needs is in `img/`.

## Editing

The page is plain HTML with its CSS inline at the top, so it opens in any editor
and needs no build step. Colours are tokens on `:root` and are defined twice, once
for light and once for dark, because the page follows the reader's own setting.

## The videos

Encoded H.264 Main profile, level 3.1. That is deliberate: an earlier cut used High
profile and would not play on iPhone Safari, which showed a crossed-out play symbol
rather than any error. Keep new videos at Main and `yuv420p`, and run
`-movflags +faststart` so playback begins before the whole file has downloaded.

The one exception to 3.1 is `img/web/kygo-desk.mp4`, the laptop film in the Web
pages section: it is 1920x1200 for sharpness, which needs level 4.0 (still Main
profile). The masters and the recorder behind it are in the private workspace
repo under `reels/web-pages/`.

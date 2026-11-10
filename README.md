# Blend

The site for Blend, a Cairo agency: UGC video, branded giveaways, ushers and events.

Served by GitHub Pages from the default branch root. `index.html` is a single
standalone page; everything it needs is in `img/`.

## Editing

The page is plain HTML with its CSS inline at the top, so it opens in any editor
and needs no build step. Colours are tokens on `:root` and are defined twice, once
for light and once for dark, because the page follows the reader's own setting.

## The videos

Encoded H.264 Main profile, level 3.1. That is deliberate: an earlier cut used High
profile and would not play on iPhone Safari, which showed a crossed-out play symbol
rather than any error. Keep new videos at Main/3.1 and `yuv420p`, and run
`-movflags +faststart` so playback begins before the whole file has downloaded.

## What is not in here yet

Photographs of branded giveaways. That section is the only one carrying no work,
and it shows next to the nine event posts.

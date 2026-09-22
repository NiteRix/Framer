# Changelog

## 1.0.1

Fixes the panel never showing a reference frame, and the clip size coming up
unknown. Both were found on Premiere 26.0.1 with an H.264 MP4.

### Reference frames are rendered by Premiere

1.0.0 read the reference frame by decoding the media file in the panel, and
fell back to `Sequence.exportFramePNG` when that failed. Both failed together:
the panel's embedded browser opened the MP4 but reported its video track as
0x0, and `exportFramePNG` does not exist on the standard sequence object in
Premiere 26.

Frame export in Premiere lives on the QE sequence. Its `exportFramePNG` takes
a timecode string and a path without an extension, and appends `.png` itself;
Adobe's own sample panel calls it that way. Framer now moves the playhead,
renders through QE, waits for the file to finish writing, and puts the
playhead back. That is the primary path, and it handles any codec Premiere
can import. Decoding in the panel is kept only as a fallback.

Scrubbing and auto-detect use it too: detection has Premiere render eight
frames from across the clip, in sequence time, so detection still gets
motion evidence to work with.

### The clip's pixel size is read from the file

The XMP lookup only understood the attribute form (`stDim:w="1920"`), not the
element form (`<stDim:w>1920</stDim:w>`), and the project-metadata lookup
looked for an `ImageSize` column when Premiere's is `VideoInfo`. Both are
fixed, and behind them is a new fallback that reads the size from the MP4/MOV
header itself - `moov` → `trak` → `tkhd`, only header bytes, including 64-bit
box sizes and `moov` stored after the media, as recorders write it. Rotated
phone footage reports its displayed size.

If even that fails, the panel takes the sequence frame size, says so, and
points at where to correct it, instead of leaving the size blank.

### Smaller fixes

- **Copy log** copies. CEP's browser has no async Clipboard API, so it had
  been falling back to selecting the text.
- A warning when the clip's aspect ratio does not match the sequence it is
  read from, since the rendered frame would not line up with the clip.

### Testing

The host script now runs under Node against a fake Premiere shaped like the
build that failed: no DOM frame export, QE present, metadata without a frame
size, and an export that lands on disk after the call returns.
`test/host.test.js` covers still rendering and dimension lookup, and
`test/mp4dims.test.js` covers the header reader, including a virtual 6 GB file
where the size is found after reading under 2 KB. 65 tests, up from 38.

The browser smoke test was rewritten. It had fed the panel a WebM the browser
could decode, which is how this shipped. It now uses an undecodable MP4 with
Premiere-rendered stills as the normal case, and adds scenarios for a missing
size, a mismatched aspect ratio, the decode fallback, and total failure.

## 1.0.0

First release.

Reframes a horizontal clip to vertical with the webcam region layered on top,
and builds the result as a real editable sequence rather than an export.

### What it does

Select a 16:9 clip, mark the gameplay and webcam regions, pick a template, and
Framer creates a 1080x1920 sequence with the same clip stacked on several video
tracks — gameplay on one, the webcam crop on the track above it, optionally a
blurred fill underneath. Every layer is an ordinary clip carrying ordinary Crop
and Motion values, so the result can be edited by hand afterwards.

Four templates: split bands, webcam overlay on full-bleed gameplay, blurred
background with a letterboxed gameplay band, and a plain fullscreen crop.
Output at 9:16, 4:5 or 1:1.

### Placing a region exactly

Crop does not recentre a clip and Motion scales about the frame centre, so a
cropped region's centre lands at `position + scale * (regionCentre -
frameCentre)`. Framer inverts that to solve for position, and first fits each
region to its band's aspect ratio, so bands fill exactly — no black edges and
nothing spilling into the neighbouring layer.

### Finding the webcam

Auto-detection samples ten frames and scores candidate rectangles on border
strength, how differently the inside moves from its surroundings, corner
proximity and plausible size. It reports a confidence and can always be
overruled by dragging the box.

### Verification

38 dependency-free Node tests cover the solver — by simulating Premiere's
transform pipeline and asserting each region lands on its target within a pixel
across four source resolutions, four webcam positions and every template —
plus detection, panel wiring, and a parse check over every shipped script.

A separate browser test boots the real panel against a stubbed CEP host and
drives it end to end. It can be pointed at a staged or installed payload with
`FRAMER_EXT`, which is how a build is checked before release.

### Known limitations

- Premiere's **Default Media Scaling** preference must be set to **None**. No
  scripting API exists to read or change it.
- The webcam layer is rectangular: clip opacity masks cannot be created from a
  script. Drop Shadow is applied, because that effect can be.
- Framing is static — there is no keyframed subject tracking.
- The reference frame comes from the media file, so preview codec support is
  the browser's. Other codecs fall back to a still rendered from the active
  sequence, which includes every visible track.

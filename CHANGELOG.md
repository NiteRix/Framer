# Changelog

## 1.2.0

### Safe zones

A new **Safe zones** card shows the video on a phone screen with the
interface of **TikTok**, **YouTube Shorts** or **Instagram Reels** over it -
the button column, caption, top tabs and navigation bar - or all three at
once, where the outlined clear area is the part none of them covers. The mock
interface, the clear-area outline and dimming outside it switch on and off
separately.

It shows either the **layout preview**, before building, or the frame under
Premiere's **playhead** in whatever sequence is open, so a finished edit can
be checked too. **Follow the playhead** re-renders it every second and a half
while the panel is idle. On the layout preview it also works out how much of
the webcam box each part of the interface hides and says so - the split
template's default webcam band, for instance, loses about a third of itself
under TikTok's top tabs.

The geometry lives in `js/core/safezones.js`, measured on a 1080 x 1920
screen; 4:5 and 1:1 videos are placed full width and centred, as the apps
show them. The interface is a generic mock-up, not the apps' artwork.

### Smaller changes

- Stills Premiere renders are tagged by what they are for, and only stills with
  the same tag are cleared, so a safe-zone refresh can never delete a reference
  frame the panel is still loading.
- Repeated playhead grabs do not fill the log.

89 tests, up from 83; the browser test drives every platform, both sources,
following the playhead and the horizontal-sequence warning.

## 1.1.0

Fixes from using 1.0.1 on real footage: layers were cropped with no way back,
the audio came in once per layer, and the gameplay was hard to centre.

### Layers keep their full frame

1.0 cropped every layer tight to its region. That looked right, but if you
deleted the webcam for a few seconds the gameplay was cut off at its band,
with nothing behind the black to reframe.

Now a layer is only cropped on the sides where the rest of its frame would
actually show over another layer. In the split template the gameplay layer is
not cropped at all, and the webcam is only cut off along the edge where the
gameplay starts; everything else runs off the canvas or sits under the layer
above. The sequence looks identical - a new test samples every template, both
crop modes and several webcam positions point by point and requires the same
source pixel on top everywhere - but each clip keeps its whole picture. The
old behaviour is one checkbox away (**Keep the full frame on each layer**).

### Focus moments

A new **Focus moments** card. Cut a moment out of the vertical sequence (Add
Edit to All Tracks at each end), click the piece, and press **Gameplay only**
or **Webcam only**: that layer is re-framed to fill the canvas with no crop and
the other is switched off, for that piece only. **Back to layout** restores the
values it was built with. The panel remembers the layout of each sequence it
built, so this works on any of them, not just the last.

### The audio is in once

Every layer was placed with the source clip itself, and Premiere brings a
clip's audio along wherever it goes - three layers, three copies of the audio.
Layers are now video-only subclips (in a **Framer** bin) and the audio goes on
A1 once, from an audio-only subclip. On a Premiere that cannot make subclips,
the clip is placed as before and the extra audio copies are unlinked and
removed. The trim is carried by the subclips, so the source clip's in and out
points are no longer touched. Clips are overwritten onto the empty tracks
rather than inserted, so nothing can ripple.

### Framing the gameplay

- **Fit gameplay** frames the gameplay as close to the middle of the frame as
  it can go without taking in the webcam - moving only as far as it must,
  going above or below the webcam when that keeps it more central, and keeping
  a small clearance from the overlay border. It used to push the crop flush
  against the far side of the webcam, off centre. It also tested for overlap
  with a duplicate-detection helper that only fired above 60% overlap, so it
  could leave the gameplay over the webcam.
- **Centre the box** buttons centre the selected box across or up and down.
- Boxes snap to the centre lines while dragged, with a guide shown.
- The box drawn is now the box used. Where a template fixes a layer's shape,
  the region was silently refitted at build time, so the gameplay box could
  show the whole frame while the plan used a narrow slice of it. The picker now
  shows the fitted box, resizing holds the shape exactly and stays inside the
  frame, and the original box is kept so switching templates starts from it.
- Detecting the webcam frames the gameplay clear of it, if you have not placed
  the gameplay yourself.

### Smaller fixes

- The preview draws each layer with its actual crop, so it shows exactly what
  the full-frame layers do.
- Calibrate added Crop to the first clip on the track instead of the selected
  one.
- The layer summary says what each layer is cropped along.
- `npm run icons` pointed at a folder that does not exist.

### Testing

`test/fake-timeline.js` is a fake Premiere timeline - linked audio, subclips,
QE effects, cutting - so `framerBuild` and `framerFocus` run under Node. Run
against 1.0.1's host script it reproduces the triple audio. The browser test
now also drives Fit, Centre, an aspect-locked corner drag, both crop modes and
a Focus round trip. 83 tests, up from 65.

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

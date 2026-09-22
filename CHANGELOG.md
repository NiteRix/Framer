# Changelog

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

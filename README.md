# Framer

Auto-reframe horizontal video to vertical inside Adobe Premiere Pro, with the
webcam region layered on top — the [StreamLadder](https://streamladder.com)
workflow, but as a panel that builds a real, editable sequence instead of an
exported file.

Point it at a 16:9 clip, tell it where the webcam is, pick a template, and it
builds a 1080×1920 sequence with the same clip stacked on several tracks:
gameplay on one, the webcam crop on the track above it, optionally a blurred
fill underneath. Every layer is an ordinary clip with ordinary Crop and Motion
values, so you can keep editing it by hand afterwards.

```
  ┌──────────────────────────┐          ┌──────────┐  V3  webcam crop
  │        ┌────┐            │          │ ┌──────┐ │
  │        │cam │  gameplay  │   ───▶   │ │ cam  │ │  V2  gameplay crop
  │        └────┘            │          │ └──────┘ │
  │                          │          │ gameplay │  V1  blurred fill
  └──────────────────────────┘          └──────────┘      (optional)
         1920 × 1080                    1080 × 1920
```

## Install

Grab the latest build from [Releases](https://github.com/NiteRix/Framer/releases):

| You are on | Get |
|---|---|
| **Windows** | `Framer-1.0.0-Setup.exe` — run it, restart Premiere |
| **macOS** | `Framer-1.0.0-portable.zip` — unpack, double-click `Install-Mac.command`, restart Premiere |

The portable zip works on Windows too: unpack it and double-click
`Install-Windows.bat`. Both install into your own user folder, so there is no
admin prompt. Neither is signed with an Adobe certificate, so the installer
also switches on CEP's "allow unsigned extensions" setting — that is what makes
the panel load at all.

Then open it from **Window → Extensions → Framer**.

To remove it, run `Uninstall-Windows.bat` / `Uninstall-Mac.command`, or use
Add/Remove Programs on Windows if you used the installer.

Requires Premiere Pro CC 2019 (13.0) or later.

**One Premiere setting matters:** Preferences → Media → **Default Media
Scaling** must be **None**. On any other setting Premiere rescales the clips
Framer places and the layers will not match the preview.

### From a checkout

```bash
git clone https://github.com/NiteRix/Framer.git
cd Framer
./Install-Mac.command          # or: Install-Windows.bat
```

## Using it

1. **Select the clip.** Click it on the timeline (its trim is picked up) or in
   the Project panel, then press **Read selection**. The panel loads a
   reference frame from the media file.
2. **Mark the regions.** Press **Auto-detect webcam** and check the box it
   draws, or drag it yourself. The **Gameplay** tab marks what should fill the
   main area; **Fit gameplay** moves it clear of the webcam.
3. **Pick a template** and adjust it. The preview is drawn from the same
   numbers that get written into Premiere, so it is not an approximation.
4. **Build vertical sequence.** A new sequence appears in the project; the
   original is untouched.

### Templates

| Template | What you get |
| --- | --- |
| **Split** | Webcam band and gameplay band stacked, both full width. Band split and gap are adjustable. |
| **Overlay** | Gameplay fills the frame, webcam floats over it in any of nine positions. |
| **Blurred background** | Uncropped gameplay band over a blurred copy of the whole frame, webcam above it. |
| **Fullscreen crop** | One region blown up to fill the frame. No webcam layer. |

Output presets cover 9:16, 4:5 and 1:1.

## How it works

Each layer is another copy of the source clip on its own video track, shaped by
three parameters:

- **Crop** (Left/Top/Right/Bottom) discards everything outside the region. The
  frame keeps its original size — the discarded pixels just become
  transparent, and the clip is *not* recentred.
- **Motion → Scale** scales the frame about its centre.
- **Motion → Position** places the frame centre, normalised to the sequence.

So the visible region's centre lands at `position + scale × (regionCentre −
frameCentre)`. Framer solves that for position, which is what lets a region
from anywhere in the source frame land exactly on its band:

```
position = (targetCentre − scale × (regionCentre − frameCentre)) / sequenceSize
```

Before solving, the region is adjusted to its band's aspect ratio
(`fitRectToAspect`), so bands fill exactly — no black edges, and nothing
spilling into the neighbouring layer. `test/layout.test.js` verifies this by
simulating Premiere's transform pipeline and asserting each region lands on its
target to within a pixel, across four source resolutions, four webcam
positions, and every template.

Webcam detection samples ten frames and looks for a rectangle whose edges are
long, straight, persistent gradient lines — an overlay box is composited onto
the capture, so its border survives averaging — then scores candidates on
border strength, how differently the inside moves from the surroundings,
corner proximity and plausible size. It reports a confidence, and you can
always overrule it.

## Known limitations

- **Set Default Media Scaling to "None"** (Preferences → Media). With it set to
  "Scale to Frame Size" or "Set to Frame Size", Premiere applies its own
  scaling to inserted clips and Framer's Motion values no longer mean what the
  preview shows.
- **Rounded corners and circular webcam masks are not applied.** Premiere's
  scripting API cannot create clip opacity masks, so the webcam layer is
  rectangular. Add a mask by hand on the webcam clip's Opacity if you want one.
  Drop Shadow *is* applied, because that effect can be scripted.
- **The framing is static.** There is no keyframed subject tracking; a region
  is chosen once and held for the clip.
- **Preview codec support is the browser's.** The reference frame comes from
  the media file, so H.264/HEVC/VP9/AV1 work. For ProRes, DNxHD, MXF and
  similar, Framer falls back to a still rendered from the active sequence —
  which shows every visible track, not just your clip. The panel says which
  source it used.
- **Crop parameter units vary between builds.** Premiere shows Crop as a
  percentage, but some versions expect 0–1 from a script. If a built layer
  looks cropped to nothing, use **Advanced → Calibrate** once and switch the
  setting.
- **Non-English Premiere**: effect and parameter names are localised, so
  Framer matches several spellings and falls back to each effect's documented
  parameter order. If an effect cannot be applied, it says so in the log rather
  than failing silently.

## Development

```bash
npm test              # 38 tests: geometry, detection, panel wiring, syntax
```

The geometry and detection modules (`extension/js/core/`) are dependency-free
and run under Node, which is what the suite exercises. `test/panel/smoke.js`
boots the actual panel in Chromium against a stubbed CEP host and drives it end
to end — it caught a preview bug that unit tests could not:

```bash
npm install --no-save playwright && npx playwright install chromium
npm run fixture       # records a synthetic capture with a known webcam box
npm run test:panel    # screenshots of each template land in test/panel/
```

Set `FRAMER_EXT` to point that test at a staged or installed payload rather
than the checkout, which is how a build is verified before release:

```bash
FRAMER_EXT="$HOME/Library/Application Support/Adobe/CEP/extensions/com.niterix.framer" \
  npm run test:panel
```

With the extension installed, `.debug` exposes the panel's dev tools at
<http://localhost:8088> while Premiere is running.

Pushing to any branch builds a Windows `.exe` and a portable zip via
[`.github/workflows/build-installer.yml`](.github/workflows/build-installer.yml);
they land as artifacts on the run. Tagging `v*` — or running the workflow
manually with a `release_tag` — attaches them to a GitHub release.

```
extension/                     the payload that gets installed
  CSXS/manifest.xml            extension manifest (CEP 9-12, Premiere 13.0+)
  index.html                   panel markup
  css/framer.css               panel styling
  js/core/layout.js            templates and the crop/scale/position solver
  js/core/detect.js            webcam rectangle detection
  js/app/host.js               promise bridge to ExtendScript
  js/app/media.js              media loading and frame sampling
  js/app/preview.js            region picker and composite preview
  js/app/ui.js                 panel controller
  jsx/framer.jsx               Premiere host script: sequence building, effects
installer/windows/             Inno Setup script for the .exe
scripts/make-icons.js          regenerates the panel icons
test/                          test suite
docs/TROUBLESHOOTING.md        when something does not work
```

To distribute it without the unsigned-extension step, sign `extension/` into a
`.zxp` with Adobe's `ZXPSignCmd`.

## Licence

MIT. Bundles Adobe's `CSInterface.js` and Douglas Crockford's `json2.jsx`, both
under their own permissive terms.

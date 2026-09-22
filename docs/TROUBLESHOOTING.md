# Troubleshooting

## Windows says the installer is unsigned

Expected. The installer is not code-signed, so SmartScreen shows "Windows
protected your PC". Click **More info → Run anyway**, or use the portable zip
instead and run `Install-Windows.bat`.

The same applies to the extension itself: it carries no Adobe signing
certificate, which is why the installer switches on CEP's "allow unsigned
extensions" setting. Without that, Premiere silently refuses to load the panel.

## The panel is not in Window > Extensions

In order of likelihood:

1. **Premiere was open during install.** Restart it — the extensions folder is
   only scanned at launch.
2. **The unsigned-extension setting did not take.** Check that
   `HKCU\Software\Adobe\CSXS.11` (and `.12`) has a string value
   `PlayerDebugMode` = `1`. On macOS:
   `defaults read com.adobe.CSXS.11 PlayerDebugMode`. The installers write keys
   for CEP 6 through 12; if your Premiere is newer than those, add the next
   number.
3. **The files landed somewhere else.** They should be at
   `%APPDATA%\Adobe\CEP\extensions\com.niterix.framer` (Windows) or
   `~/Library/Application Support/Adobe/CEP/extensions/com.niterix.framer`
   (macOS), with `CSXS/manifest.xml` directly inside.
4. **Premiere is older than CC 2019.** The manifest declares 13.0 as the
   minimum.

## The layers do not line up with the preview

Almost always **Default Media Scaling**. In Premiere:

- Windows: Edit → Preferences → Media → Default Media Scaling
- macOS: Premiere Pro → Settings → Media → Default Media Scaling

Set it to **None**. On "Scale to Frame Size" or "Set to Frame Size", Premiere
applies its own scaling to every clip it inserts, on top of the Motion values
Framer writes, so everything ends up the wrong size. There is no scripting API
to read or change this preference, which is why Framer cannot just fix it for
you.

Rebuild the sequence after changing it — existing clips keep the old scaling.

## A layer is cropped to nothing, or not cropped at all

Premiere shows Crop as a percentage, but some builds expect `0–1` from a
script rather than `0–100`. Open **Advanced → Calibrate against selected clip**
with any clip selected on a timeline: it writes Crop → Left and tells you what
Effect Controls should read. If it reads something other than 25%, switch
**Crop values are written as** to the other setting and build again.

## Framer subclips in the project

Each build adds a video-only and an audio-only subclip of the source to a
**Framer** bin; the layers and the audio are made from them. That is what keeps
the audio to one copy. Delete the bin once you no longer need the sequences
built from it.

## The audio is on more than one track

The build log (Advanced) says how the audio was placed. A Premiere that cannot
make subclips gets the clip itself on every layer, and Framer then unlinks and
removes the extra audio copies. If the log says the removal failed, delete the
extra audio clips by hand - keep the one on A1.

## Focus moments says the clip "is not cut at the same points"

Focus changes the piece you selected and the pieces directly above and below
it with the same in and out. Cut with **Sequence > Add Edit to All Tracks**
(Ctrl/Cmd+Shift+K) so every layer track is cut in the same place. A layer that
is not cut there is left alone rather than changed for its whole length.

If Focus says the sequence "was not built by Framer", open the vertical
sequence itself. The panel remembers the last 30 sequences it built.

## "Could not apply effect ... it may be named differently in this language"

Framer adds effects by name, and Premiere localises those names. It tries
several spellings and falls back to each effect's documented parameter order,
but a non-English install can still miss. The layer is still placed, scaled and
positioned — only the optional Crop, Gaussian Blur or Drop Shadow is missing,
and you can add it by hand. The panel log (Advanced) names which one failed.

## No reference frame

Premiere renders the reference frame from the **active sequence**, so:

1. **Select the clip on a sequence that is open and active.** A clip picked
   in the Project panel gives Framer no sequence time to render from, so it
   renders whatever is under the playhead.
2. **Make sure the clip is visible there.** A disabled track, a clip hidden
   under another, or the playhead parked off the clip all produce the wrong
   frame, because Framer shows exactly what the sequence shows.

If Premiere refuses to render at all, the log under **Advanced** says which
export call failed. Framer then tries decoding the file in the panel, which
works for WebM and a few other browser formats but usually not H.264 MP4s.

## "Assumed from the sequence" next to the source size

Framer could not read the clip's own pixel size - not from Premiere's metadata
and not from the file header (which covers MP4 and MOV) - so it assumed the
clip matches the sequence. That is right whenever the clip fills the sequence
at 100%. If it does not, open **Source size is wrong?**, type the real size,
and press Apply; everything downstream recalculates.

## "The reference frame will not line up with the clip"

The clip and the sequence have different aspect ratios, so the rendered frame
has the clip letterboxed or cropped inside it, and regions drawn on it will not
map onto the clip. Read the selection from a sequence that matches the clip:
right-click the clip in the Project panel → **New Sequence From Clip**.

## Auto-detect picks the wrong box

It looks for a rectangle with strong, straight, persistent edges — a webcam
overlay with a border. A borderless webcam feathered into the background, or
one that fills half the frame, gives it little to work with. Drag the box
yourself; the numbers under the frame accept exact percentages.

## The webcam corners are square and I want them rounded

Premiere's scripting API cannot create clip opacity masks, so Framer cannot
make one. Select the webcam layer, open Effect Controls → Opacity, and draw an
ellipse or rounded rectangle mask by hand. Drop Shadow is applied by Framer,
because that effect *can* be scripted.

## Nothing happens when I press Build

Check the log under **Advanced**. Every host-side failure is reported there
with a reason. Common causes: no clip selected when Read selection was pressed,
or the project item was removed between reading and building.

With the panel open you can also attach Chrome to it at
<http://localhost:8088> — `.debug` ships in the installed folder, so the
remote dev tools are available without a special build.

## Reporting a problem

Press **Copy log** under Advanced and include that, plus your Premiere version
from the **Diagnostics** button, at
<https://github.com/NiteRix/Framer/issues>.

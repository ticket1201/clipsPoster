import { describe, expect, it } from "vitest";
import {
  buildBrandSvg,
  buildSplitVerticalFilter,
  buildTikTokVerticalFilter,
  buildVerticalFilter,
  buildWebcamOnlyVerticalFilter,
  buildVideoEncoderArgs,
  resolveWebcamCrop,
  selectStableFaceCrop,
} from "../src/index.js";

describe("buildVerticalFilter", () => {
  it("builds a 9:16 composition with a branding overlay", () => {
    const filter = buildVerticalFilter();
    expect(filter).toContain("scale=1080:1920");
    expect(filter).toContain("[composed][1:v]overlay=(W-w)/2:1248");
  });

  it("creates a Twitch badge with the source and nickname", () => {
    const svg = buildBrandSvg("TWITCH", "xQc");
    expect(svg).toContain("#9146FF");
    expect(svg).toContain("TWITCH.TV/XQC");
    expect(svg).toContain("СТРИМЫ ТУТ");
    expect(svg).toContain('<path fill="#fff"');
  });

  it("keeps the branded source badge in the TikTok composition", () => {
    const filter = buildTikTokVerticalFilter();
    expect(filter).toContain("scale=1080:1920");
    expect(filter).toContain("[composed][1:v]overlay=(W-w)/2:1248");
  });

  it("builds a split face and gameplay composition", () => {
    const filter = buildSplitVerticalFilter({ x: 10, y: 20, width: 420, height: 264 });
    expect(filter).toContain("crop=420:264:10:20");
    expect(filter).toContain("overlay=0:650");
    expect(filter).toContain("overlay=(W-w)/2:560");
  });

  it("keeps the gameplay crop centered", () => {
    const filter = buildSplitVerticalFilter({
      x: 0, y: 300, width: 346, height: 218, sourceWidth: 1280, sourceHeight: 720,
    });
    expect(filter).toContain("crop=594:698:344:10,scale=1080:1270");
  });

  it("keeps the complete source video in the centered webcam-only rectangle", () => {
    const filter = buildWebcamOnlyVerticalFilter({
      x: 10, y: 20, width: 420, height: 264, sourceWidth: 1280, sourceHeight: 720,
    });
    expect(filter).toContain("crop=1280:720:0:0");
    expect(filter).toContain("scale=1080:1780:force_original_aspect_ratio=decrease:force_divisible_by=2");
    expect(filter).toContain("overlay=(W-w)/2:(H-h)/2");
    expect(filter).toContain("boxblur=30:2");
    expect(filter).toContain("overlay=(W-w)/2:1660");
    expect(filter).not.toContain("gameSource");
  });

  it("converts a saved normalized webcam crop to source pixels", () => {
    const crop = resolveWebcamCrop(
      { x: 0, y: 0.305, width: 0.308, height: 0.347 },
      { width: 1280, height: 720 },
    );
    expect(crop).not.toBeNull();
    expect(crop?.x).toBe(0);
    expect(crop?.y).toBeCloseTo(219.6);
    expect(crop?.width).toBeCloseTo(394.24);
    expect(crop?.height).toBeCloseTo(249.84);
    expect(crop?.sourceWidth).toBe(1280);
    expect(crop?.sourceHeight).toBe(720);
  });

  it("selects a face that persists across sampled frames and ignores bottom HUD faces", () => {
    const crop = selectStableFaceCrop([
      { sample: 0, x: 0.08, y: 0.38, width: 0.06, height: 0.1 },
      { sample: 1, x: 0.09, y: 0.39, width: 0.06, height: 0.1 },
      { sample: 2, x: 0.085, y: 0.385, width: 0.06, height: 0.1 },
      { sample: 0, x: 0.8, y: 0.86, width: 0.08, height: 0.1 },
      { sample: 1, x: 0.8, y: 0.86, width: 0.08, height: 0.1 },
    ], { width: 1280, height: 720 });
    expect(crop).not.toBeNull();
    expect(crop!.x).toBe(0);
    expect(crop!.y).toBeGreaterThan(100);
  });

  it("uses a tight crop for a small streamer webcam", () => {
    const crop = selectStableFaceCrop([
      { sample: 0, x: 0.07, y: 0.43, width: 0.02, height: 0.035 },
      { sample: 1, x: 0.071, y: 0.431, width: 0.02, height: 0.035 },
    ], { width: 1280, height: 720 });
    expect(crop).not.toBeNull();
    expect(crop!.width).toBeCloseTo(345.6, 1);
    expect(crop!.x).toBe(0);
  });

  it("uses Kick green and escapes XML text", () => {
    const svg = buildBrandSvg("KICK", "name<&");
    expect(svg).toContain("#53FC18");
    expect(svg).toContain("KICK.COM/NAME&lt;&amp;");
    expect(svg).toContain("СТРИМЫ ТУТ");
  });

  it("uses VideoToolbox on macOS and a fast software fallback elsewhere", () => {
    expect(buildVideoEncoderArgs("darwin")).toContain("h264_videotoolbox");
    expect(buildVideoEncoderArgs("linux")).toEqual([
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
    ]);
  });
});

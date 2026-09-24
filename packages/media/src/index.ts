import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

const storageRoot = fileURLToPath(new URL("../../../storage/", import.meta.url));
const rawDirectory = join(storageRoot, "raw");
const processedDirectory = join(storageRoot, "processed");
const toolsDirectory = join(storageRoot, "tools");
const faceDetectorPath = join(toolsDirectory, "detect-face");
const faceDetectorSourcePath = fileURLToPath(new URL("../scripts/detect-face.m", import.meta.url));

export interface ProcessedMedia {
  rawFilePath: string;
  processedFilePath: string;
  tiktokFilePath: string;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface WebcamCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SampledFace extends FaceBox {
  sample: number;
}

interface VideoSize {
  width: number;
  height: number;
}

const TOP_PANEL_HEIGHT = 680;
const GAME_PANEL_Y = 650;
const GAME_PANEL_HEIGHT = 1270;
const BRAND_Y = 560;
const WEBCAM_ONLY_BRAND_Y = 1660;

export const buildVerticalFilter = (): string => {
  return [
    "[0:v]split=2[background][foreground]",
    "[background]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[blurred]",
    "[foreground]scale=1080:1920:force_original_aspect_ratio=decrease[video]",
    "[blurred][video]overlay=(W-w)/2:(H-h)/2[composed]",
    "[composed][1:v]overlay=(W-w)/2:1248:format=auto[outv]",
  ].join(";");
};

export const buildSplitVerticalFilter = (faceCrop: FaceBox): string => {
  const crop = [faceCrop.width, faceCrop.height, faceCrop.x, faceCrop.y]
    .map((value) => Math.round(value / 2) * 2);
  const sourceWidth = faceCrop.sourceWidth;
  const sourceHeight = faceCrop.sourceHeight;
  const gameFilter = sourceWidth && sourceHeight
    ? (() => {
      const gameHeight = sourceHeight * 0.97;
      const gameWidth = gameHeight * 1080 / GAME_PANEL_HEIGHT;
      const gameX = (sourceWidth - gameWidth) / 2;
      const gameY = (sourceHeight - gameHeight) / 2;
      const gameCrop = [gameWidth, gameHeight, gameX, gameY].map((value) => Math.round(value / 2) * 2);
      return `[gameSource]crop=${gameCrop.join(":")},scale=1080:${GAME_PANEL_HEIGHT}[game]`;
    })()
    : `[gameSource]scale=1080:${GAME_PANEL_HEIGHT}:force_original_aspect_ratio=increase,crop=1080:${GAME_PANEL_HEIGHT}[game]`;
  return [
    "color=c=#050806:s=1080x1920[canvas]",
    "[0:v]split=2[faceSource][gameSource]",
    `[faceSource]crop=${crop.join(":")},scale=1080:${TOP_PANEL_HEIGHT}:force_original_aspect_ratio=increase,crop=1080:${TOP_PANEL_HEIGHT}[face]`,
    gameFilter,
    "[canvas][face]overlay=0:0[withFace]",
    `[withFace][game]overlay=0:${GAME_PANEL_Y}[split]`,
    `[split][1:v]overlay=(W-w)/2:${BRAND_Y}:format=auto[outv]`,
  ].join(";");
};

export const buildWebcamOnlyVerticalFilter = (faceCrop: FaceBox): string => {
  const crop = faceCrop.sourceWidth && faceCrop.sourceHeight
    ? [faceCrop.sourceWidth, faceCrop.sourceHeight, 0, 0]
    : [faceCrop.width, faceCrop.height, faceCrop.x, faceCrop.y];
  const roundedCrop = crop
    .map((value) => Math.round(value / 2) * 2);
  return [
    `[0:v]crop=${roundedCrop.join(":")},split=2[webcamBackgroundSource][webcamSource]`,
    "[webcamBackgroundSource]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:2[webcamBackground]",
    "[webcamSource]scale=1080:1780:force_original_aspect_ratio=decrease:force_divisible_by=2[webcam]",
    "[webcamBackground][webcam]overlay=(W-w)/2:(H-h)/2[centeredWebcam]",
    `[centeredWebcam][1:v]overlay=(W-w)/2:${WEBCAM_ONLY_BRAND_Y}:format=auto[outv]`,
  ].join(";");
};

export const buildTikTokVerticalFilter = (): string => {
  return buildVerticalFilter();
};

export const buildBrandSvg = (source: "KICK" | "TWITCH", nickname: string): string => {
  if (source === "KICK") return buildKickBrandSvg(nickname);
  return buildTwitchBrandSvg(nickname);
};

export const buildVideoEncoderArgs = (platform = process.platform): string[] => platform === "darwin"
  ? [
    "-c:v", "h264_videotoolbox",
    "-realtime", "1",
    "-b:v", "6M",
    "-maxrate", "10M",
    "-bufsize", "12M",
  ]
  : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"];

const buildKickBrandSvg = (nickname: string): string => {
  const address = `KICK.COM/${nickname.slice(0, 24)}`.toUpperCase();
  return `<svg width="900" height="210" viewBox="0 0 900 210" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-10%" y="-20%" width="120%" height="150%">
        <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity="0.28"/>
      </filter>
    </defs>
    <g filter="url(#shadow)">
      <rect x="20" y="66" width="860" height="132" rx="28" fill="#fff" stroke="#53FC18" stroke-width="6"/>
      <rect x="258" y="10" width="384" height="82" rx="41" fill="#fff" stroke="#53FC18" stroke-width="6"/>
      <circle cx="334" cy="51" r="42" fill="#53FC18"/>
      <text x="334" y="62" text-anchor="middle" fill="#050505" font-family="Arial Black, Arial, sans-serif" font-size="25" font-weight="900">KICK</text>
      <text x="476" y="61" text-anchor="middle" fill="#111" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800">СТРИМЫ ТУТ</text>
      <text x="450" y="158" text-anchor="middle" fill="#53FC18" stroke="#111" stroke-width="2.5" paint-order="stroke" font-family="Arial Black, Arial, sans-serif" font-size="52" font-weight="900">${escapeXml(address)}</text>
    </g>
  </svg>`;
};

const buildTwitchBrandSvg = (nickname: string): string => {
  const address = `TWITCH.TV/${nickname.slice(0, 24)}`.toUpperCase();
  return `<svg width="900" height="210" viewBox="0 0 900 210" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-10%" y="-20%" width="120%" height="150%">
        <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity="0.28"/>
      </filter>
    </defs>
    <g filter="url(#shadow)">
      <rect x="20" y="66" width="860" height="132" rx="28" fill="#fff" stroke="#9146FF" stroke-width="6"/>
      <rect x="258" y="10" width="384" height="82" rx="41" fill="#fff" stroke="#9146FF" stroke-width="6"/>
      <circle cx="334" cy="51" r="42" fill="#9146FF"/>
      <path fill="#fff" d="M307 25h54v40l-15 15h-13l-13 12V80h-13V25Zm9 9v36h13v10l11-10h12V34h-36Z"/>
      <path fill="#9146FF" d="M327 43h6v17h-6V43Zm14 0h6v17h-6V43Z"/>
      <text x="476" y="61" text-anchor="middle" fill="#111" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800">СТРИМЫ ТУТ</text>
      <text x="450" y="158" text-anchor="middle" fill="#9146FF" stroke="#111" stroke-width="2.5" paint-order="stroke" font-family="Arial Black, Arial, sans-serif" font-size="52" font-weight="900">${escapeXml(address)}</text>
    </g>
  </svg>`;
};

export const downloadAndBrandClip = async (
  sourceUrl: string,
  clipId: string,
  source: "KICK" | "TWITCH",
  nickname: string,
  webcamCrop?: WebcamCrop | null,
  webcamOnly = false,
): Promise<ProcessedMedia> => {
  await Promise.all([
    mkdir(rawDirectory, { recursive: true }),
    mkdir(processedDirectory, { recursive: true }),
  ]);
  const safeId = clipId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const rawFilePath = join(rawDirectory, `${safeId}.mp4`);
  const processedFilePath = join(processedDirectory, `${safeId}-vertical.mp4`);
  const tiktokFilePath = processedFilePath;
  const overlayFilePath = join(processedDirectory, `${safeId}-brand.png`);

  if (!(await hasUsableFile(rawFilePath))) {
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", sourceUrl,
      "-map", "0:v:0", "-map", "0:a?",
      "-c", "copy", "-movflags", "+faststart",
      rawFilePath,
    ]);
  }
  await sharp(Buffer.from(buildBrandSvg(source, nickname))).png().toFile(overlayFilePath);
  try {
    const configuredFaceCrop = webcamCrop
      ? resolveWebcamCrop(webcamCrop, await probeVideoSize(rawFilePath))
      : null;
    const faceCrop = configuredFaceCrop ?? await detectStableFaceCrop(rawFilePath);
    await renderVerticalVideo(
      ["-i", rawFilePath, "-i", overlayFilePath],
      faceCrop
        ? webcamOnly
          ? buildWebcamOnlyVerticalFilter(faceCrop)
          : buildSplitVerticalFilter(faceCrop)
        : buildTikTokVerticalFilter(),
      processedFilePath,
    );
  } finally {
    await unlink(overlayFilePath).catch(() => undefined);
  }
  return { rawFilePath, processedFilePath, tiktokFilePath };
};

export const resolveWebcamCrop = (crop: WebcamCrop, size: VideoSize): FaceBox | null => {
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (!values.every(Number.isFinite) || crop.width < 0.05 || crop.height < 0.05) return null;
  const x = Math.max(0, Math.min(0.95, crop.x));
  const y = Math.max(0, Math.min(0.95, crop.y));
  const width = Math.min(1 - x, crop.width);
  const height = Math.min(1 - y, crop.height);
  if (width < 0.05 || height < 0.05) return null;
  return {
    x: x * size.width,
    y: y * size.height,
    width: width * size.width,
    height: height * size.height,
    sourceWidth: size.width,
    sourceHeight: size.height,
  };
};

const probeVideoSize = async (videoPath: string): Promise<VideoSize> => {
  const sizeJson = await runForOutput("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "json", videoPath,
  ]);
  const probe = JSON.parse(sizeJson) as { streams?: VideoSize[] };
  const size = probe.streams?.[0];
  if (!size?.width || !size.height) throw new Error("Unable to read source video dimensions");
  return size;
};

export const detectStableFaceCrop = async (videoPath: string): Promise<FaceBox | null> => {
  if (process.platform !== "darwin") return null;
  const sampleDirectory = await mkdtemp(join(tmpdir(), "clips-poster-faces-"));
  try {
    const sizeJson = await runForOutput("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration", "-of", "json", videoPath,
    ]);
    const probe = JSON.parse(sizeJson) as { streams?: Array<VideoSize & { duration?: string }> };
    const size = probe.streams?.[0];
    const duration = Number(size?.duration);
    if (!size || !Number.isFinite(duration) || duration <= 0) return null;

    const tiles = [0, 0.29, 0.58].flatMap((x) => [0, 0.42].map((y) => ({
      x, y, width: 0.42, height: 0.58,
    })));
    const samples = [0.18, 0.38, 0.58, 0.78].map((fraction, sample) => ({
      sample, time: duration * fraction,
      tiles: tiles.map((tile, tileIndex) => ({
        ...tile, path: join(sampleDirectory, `sample-${sample}-${tileIndex}.jpg`),
      })),
    }));
    await Promise.all(samples.map(({ time, tiles: sampleTiles }) => {
      const splitOutputs = sampleTiles.map((_, index) => `[source${index}]`).join("");
      const filters = [`[0:v]split=${sampleTiles.length}${splitOutputs}`];
      sampleTiles.forEach((tile, index) => {
        filters.push(`[source${index}]crop=iw*${tile.width}:ih*${tile.height}:iw*${tile.x}:ih*${tile.y}[tile${index}]`);
      });
      return run("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error", "-ss", time.toFixed(3), "-i", videoPath,
        "-filter_complex", filters.join(";"),
        ...sampleTiles.flatMap((tile, index) => ["-map", `[tile${index}]`, "-frames:v", "1", "-q:v", "3", tile.path]),
      ]);
    }));
    const detectionArguments = samples.flatMap(({ sample, tiles: sampleTiles }) => sampleTiles.map((tile) =>
      `${sample}|${tile.x}|${tile.y}|${tile.width}|${tile.height}|${tile.path}`));
    await ensureFaceDetector();
    const detectionsJson = await runForOutput(faceDetectorPath, detectionArguments);
    const detections = JSON.parse(detectionsJson) as SampledFace[];
    return selectStableFaceCrop(detections, size);
  } catch {
    return null;
  } finally {
    await rm(sampleDirectory, { recursive: true, force: true });
  }
};

const ensureFaceDetector = async (): Promise<void> => {
  try {
    const [binary, source] = await Promise.all([stat(faceDetectorPath), stat(faceDetectorSourcePath)]);
    if (binary.size > 0 && binary.mtimeMs >= source.mtimeMs) return;
  } catch {
    // Build the helper below when it is missing.
  }
  await mkdir(toolsDirectory, { recursive: true });
  await run("clang", [
    "-fobjc-arc", "-framework", "Foundation", "-framework", "Vision",
    faceDetectorSourcePath, "-o", faceDetectorPath,
  ]);
};

export const selectStableFaceCrop = (detections: SampledFace[], size: VideoSize): FaceBox | null => {
  const candidates = detections.filter((face) => {
    const centerY = face.y + face.height / 2;
    return centerY < 0.76 && face.width >= 0.018 && face.height >= 0.025;
  });
  if (candidates.length === 0) return null;

  const clusters: SampledFace[][] = [];
  for (const face of candidates) {
    const centerX = face.x + face.width / 2;
    const centerY = face.y + face.height / 2;
    const cluster = clusters.find((entries) => {
      const anchor = entries[0]!;
      const anchorX = anchor.x + anchor.width / 2;
      const anchorY = anchor.y + anchor.height / 2;
      return Math.hypot(centerX - anchorX, centerY - anchorY) < 0.095;
    });
    if (cluster) cluster.push(face);
    else clusters.push([face]);
  }

  const stable = clusters
    .filter((cluster) => new Set(cluster.map((face) => face.sample)).size >= 2)
    .sort((left, right) => {
      const persistence = (cluster: SampledFace[]) => new Set(cluster.map((face) => face.sample)).size;
      const area = (cluster: SampledFace[]) => cluster.reduce((sum, face) => sum + face.width * face.height, 0) / cluster.length;
      return persistence(right) - persistence(left) || area(right) - area(left);
    })[0];
  if (!stable) return null;

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  const centerX = median(stable.map((face) => face.x + face.width / 2));
  const centerY = median(stable.map((face) => face.y + face.height / 2));
  const faceWidth = median(stable.map((face) => face.width));
  // Keep the crop tight enough that the webcam itself fills the upper panel,
  // rather than showing strips of gameplay around a small webcam overlay.
  const cropWidth = Math.min(0.52, Math.max(0.27, faceWidth * 5.5)) * size.width;
  const targetAspect = 1080 / TOP_PANEL_HEIGHT;
  const cropHeight = Math.min(size.height, cropWidth / targetAspect);
  const finalWidth = Math.min(size.width, cropHeight * targetAspect);
  const desiredX = centerX * size.width - finalWidth / 2;
  const desiredY = centerY * size.height - cropHeight * 0.1;

  return {
    x: Math.max(0, Math.min(size.width - finalWidth, desiredX)),
    y: Math.max(0, Math.min(size.height - cropHeight, desiredY)),
    width: finalWidth,
    height: cropHeight,
    sourceWidth: size.width,
    sourceHeight: size.height,
  };
};

const renderVerticalVideo = async (inputs: string[], filter: string, outputPath: string): Promise<void> => {
  const commonArgs = [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", filter,
    "-map", "[outv]", "-map", "0:a?",
  ];
  const outputArgs = [
    "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", "-shortest",
    outputPath,
  ];
  const encoderArgs = buildVideoEncoderArgs();
  try {
    await run("ffmpeg", [...commonArgs, ...encoderArgs, ...outputArgs]);
  } catch (error) {
    if (encoderArgs[1] !== "h264_videotoolbox") throw error;
    await run("ffmpeg", [
      ...commonArgs,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
      ...outputArgs,
    ]);
  }
};

const hasUsableFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
};

const escapeXml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const run = (command: string, args: string[]): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  const errors: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} failed: ${Buffer.concat(errors).toString("utf8").trim()}`));
  });
});

const runForOutput = (command: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve(Buffer.concat(output).toString("utf8").trim());
    else reject(new Error(`${command} failed: ${Buffer.concat(errors).toString("utf8").trim()}`));
  });
});

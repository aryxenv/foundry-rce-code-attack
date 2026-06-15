import { execFile } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { captureDeck } from "../capture/capture-deck.mjs";
import {
  EXPORT_ARTIFACTS,
  EXPORT_REPORT_ARTIFACTS,
  EXPORT_TIMEOUTS,
} from "../contracts/export-contracts.mjs";
import {
  DEFAULT_EXPORT_MODE,
  buildExportContractReport,
  normalizeExportMode,
} from "../contracts/native-editable-contract.mjs";
import { writePptx } from "../ooxml/pptx-writer.mjs";

const execFileAsync = promisify(execFile);
const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const repoRoot = path.resolve(serviceRoot, "..", "..");
const defaultPptxOutput = artifactPath(EXPORT_ARTIFACTS.editablePptx);
const defaultPdfOutput = artifactPath(EXPORT_ARTIFACTS.pdf);
const defaultReportOutput = artifactPath(EXPORT_REPORT_ARTIFACTS.editablePptx);

function artifactPath(artifact) {
  return path.join(repoRoot, ...artifact.relativePath.split("/"));
}

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function hasOption(name) {
  return process.argv.includes(name);
}

function stripTransientSlideData(slide) {
  const { backgroundPng, ...serializableSlide } = slide;
  const stripAssetData = (assetRef) => {
    if (!assetRef?.data) {
      return assetRef;
    }

    return {
      ...assetRef,
      data: `[${assetRef.data.length} bytes omitted from diagnostic manifest]`,
    };
  };

  return {
    ...serializableSlide,
    elements: serializableSlide.elements?.map((element) => {
      return {
        ...element,
        assetRef: stripAssetData(element.assetRef),
      };
    }),
    assets: serializableSlide.assets?.map(stripAssetData),
    nativeObjects: serializableSlide.nativeObjects?.map((object) => ({
      ...object,
      assetRef: stripAssetData(object.assetRef),
    })),
  };
}

function readExportMode() {
  if (hasOption("--debug-fidelity")) {
    return normalizeExportMode("debug-fidelity");
  }

  return normalizeExportMode(readOption("--mode", DEFAULT_EXPORT_MODE));
}

function readReportOutput() {
  if (hasOption("--no-report")) {
    if (hasOption("--report-output")) {
      throw new Error("Use either --report-output or --no-report, not both.");
    }

    return undefined;
  }

  return resolveOutput(readOption("--report-output", defaultReportOutput));
}

function resolveOutput(output) {
  return path.isAbsolute(output) ? output : path.join(repoRoot, output);
}

function isLockedFileError(error) {
  return error?.code === "EBUSY" || error?.code === "EPERM";
}

function lockedOutputMessage(outputPath) {
  return [
    `Cannot write ${outputPath} because the file is currently locked.`,
    "Close the existing PowerPoint file, stop any app previewing it, or choose a different --output path, then retry.",
  ].join("\n");
}

async function assertOutputIsWritable(outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });

  try {
    const handle = await open(outputPath, "r+");
    await handle.close();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }

    if (isLockedFileError(error)) {
      throw new Error(lockedOutputMessage(outputPath));
    }

    throw error;
  }
}

async function runPdfExport({ url, outputPath }) {
  const scriptPath = path.join(repoRoot, "scripts", "export-pdf.mjs");
  await mkdir(path.dirname(outputPath), { recursive: true });

  try {
    await execFileAsync(
      process.execPath,
      [scriptPath, "--url", url, "--output", outputPath],
      {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024 * 10,
        timeout: EXPORT_TIMEOUTS.cliMilliseconds.pdfArtifact,
      },
    );
  } catch (error) {
    const details = [error.stderr, error.stdout, error.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(details || "PDF artifact generation failed.");
  }
}

function serializableManifest({ capture, report }) {
  if (capture.manifest) {
    return {
      ...capture.manifest,
      slides: capture.manifest.slides.map(stripTransientSlideData),
      report: {
        metrics: {
          editabilityScore: report.editabilityScore,
          editableTextBoxes: report.editableTextBoxes,
          editableTextLines: report.editableTextLines,
          editableTextRuns: report.editableTextRuns,
          nativeObjects: report.nativeObjects,
          nativeObjectCounts: report.nativeObjectCounts,
          fallbackRasterRegions: report.fallbackRasterRegions,
          fallbackRasterAreaPx: report.fallbackRasterAreaPx,
          fallbackRasterRegionCounts: report.fallbackRasterRegionCounts,
          fallbackRasterReasons: report.fallbackRasterReasons,
          forbiddenFallbackRasterRegions: report.forbiddenFallbackRasterRegions,
          duplicateBakedVisibleTextRegions:
            report.duplicateBakedVisibleTextRegions,
          forbiddenDuplicateBakedVisibleText:
            report.forbiddenDuplicateBakedVisibleText,
        },
      },
    };
  }

  return {
    contractVersion: report.contractVersion,
    mode: report.mode,
    rules: report.rules,
    requiredNativeObjects: report.requiredNativeObjects,
    allowedRasterFallbackKinds: report.allowedRasterFallbackKinds,
    acceptanceCriteria: report.acceptanceCriteria,
    metrics: {
      editabilityScore: report.editabilityScore,
      editableTextBoxes: report.editableTextBoxes,
      editableTextLines: report.editableTextLines,
      editableTextRuns: report.editableTextRuns,
      nativeObjects: report.nativeObjects,
      nativeObjectCounts: report.nativeObjectCounts,
      fallbackRasterRegions: report.fallbackRasterRegions,
      fallbackRasterAreaPx: report.fallbackRasterAreaPx,
      fallbackRasterRegionCounts: report.fallbackRasterRegionCounts,
      fallbackRasterReasons: report.fallbackRasterReasons,
      forbiddenFallbackRasterRegions: report.forbiddenFallbackRasterRegions,
      duplicateBakedVisibleTextRegions: report.duplicateBakedVisibleTextRegions,
      forbiddenDuplicateBakedVisibleText:
        report.forbiddenDuplicateBakedVisibleText,
    },
    slideMetrics: report.slides,
    slides: capture.slides.map((slide) => ({
      index: slide.index,
      width: slide.width,
      height: slide.height,
      textCount: slide.texts.length,
      texts: slide.texts,
      nativeObjects: slide.nativeObjects ?? [],
      rasterFallbackRegions: slide.rasterFallbackRegions ?? [],
    })),
  };
}

function buildReport({ capture, mode, pdfOutput, pptxOutput }) {
  return buildExportContractReport({
    slides: capture.slides,
    mode,
    pdfOutput,
    pptxOutput,
  });
}

async function main() {
  const url = readOption("--url", "http://localhost:5173/");
  const pptxOutput = resolveOutput(readOption("--output", defaultPptxOutput));
  const pdfOutput = resolveOutput(readOption("--pdf-output", defaultPdfOutput));
  const mode = readExportMode();
  const manifestOutput = hasOption("--manifest-output")
    ? resolveOutput(readOption("--manifest-output"))
    : undefined;
  const reportOutput = readReportOutput();

  await assertOutputIsWritable(pptxOutput);
  await runPdfExport({ url, outputPath: pdfOutput });
  const capture = await captureDeck({ url, mode });
  try {
    await writePptx({ outputPath: pptxOutput, slides: capture.slides, mode });
  } catch (error) {
    if (isLockedFileError(error)) {
      throw new Error(lockedOutputMessage(pptxOutput));
    }

    throw error;
  }
  const report = buildReport({ capture, mode, pdfOutput, pptxOutput });

  if (manifestOutput) {
    await mkdir(path.dirname(manifestOutput), { recursive: true });
    await writeFile(
      manifestOutput,
      `${JSON.stringify(serializableManifest({ capture, report }), null, 2)}\n`,
    );
  }

  if (reportOutput) {
    await mkdir(path.dirname(reportOutput), { recursive: true });
    await writeFile(reportOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(
    [
      `PDF artifact exported to ${pdfOutput}`,
      `Editable PPTX exported to ${pptxOutput}`,
      `Mode: ${report.mode}`,
      `Slides: ${report.slideCount}`,
      `Editable text boxes: ${report.editableTextBoxes}`,
      `Editable text lines: ${report.editableTextLines}`,
      `Native objects: ${report.nativeObjects}`,
      `Fallback raster regions: ${report.fallbackRasterRegions}`,
      `Fallback raster area: ${report.fallbackRasterAreaPx}px²`,
      `Editability score: ${report.editabilityScore}`,
      reportOutput ? `Export report: ${reportOutput}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

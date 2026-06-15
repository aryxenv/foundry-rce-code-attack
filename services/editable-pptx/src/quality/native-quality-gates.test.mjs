import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import JSZip from "jszip";
import {
  EXPORT_MODES,
  NATIVE_OBJECT_KINDS,
  RASTER_FALLBACK_KINDS,
  buildExportContractReport,
  createDebugFullSlideFallback,
  createRasterFallbackRegion,
} from "../contracts/native-editable-contract.mjs";
import {
  MANIFEST_ELEMENT_TYPES,
  normalizeCapturedDeckToManifest,
} from "../manifest/slide-manifest.mjs";
import { writePptx } from "../ooxml/pptx-writer.mjs";
import {
  assertNativeQualityGates,
  inspectPptxPackage,
} from "./native-quality-gates.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const outputDir = path.join(serviceRoot, ".test-output", "quality");
const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function bounds(x, y, width, height) {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

const titleStyle = {
  fontFace: "Segoe UI",
  fontSizePx: 40,
  fontSizePt: 30,
  lineHeightPx: 48,
  lineHeightPt: 36,
  color: "111827",
  bold: true,
  italic: false,
  align: "left",
};
const bodyStyle = {
  ...titleStyle,
  fontSizePx: 24,
  fontSizePt: 18,
  lineHeightPx: 32,
  lineHeightPt: 24,
  color: "374151",
  bold: false,
};
const buttonStyle = {
  ...bodyStyle,
  color: "FFFFFF",
  bold: true,
  align: "center",
};

function nativeQualityFixture() {
  return normalizeCapturedDeckToManifest({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        index: 0,
        width: 1920,
        height: 1080,
        backgroundPng: Buffer.from("diagnostic screenshot must be suppressed"),
        elements: [
          {
            id: "main-card",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.CARD_OR_BOX,
            bounds: bounds(96, 80, 760, 360),
            shapeStyle: {
              fill: { color: "FFFFFF", opacity: 1 },
              stroke: { color: "D1D5DB", widthPx: 1 },
              radius: { radiusPx: 20 },
            },
          },
          {
            id: "hero-title",
            type: MANIFEST_ELEMENT_TYPES.TEXT,
            role: "title",
            groupId: "hero-title",
            bounds: bounds(128, 118, 620, 108),
            text: {
              content: "Native quality gates\nCatch baked fallbacks",
              style: titleStyle,
              paragraph: {
                align: "left",
                verticalAlign: "top",
                wrap: "none",
                margins: { leftPx: 0, topPx: 0, rightPx: 0, bottomPx: 0 },
              },
              runs: [],
              lines: [
                {
                  ...bounds(128, 118, 420, 46),
                  text: "Native quality gates",
                  baselineY: 154,
                  runs: [
                    {
                      text: "Native quality gates",
                      bounds: bounds(128, 118, 420, 46),
                      boxes: [bounds(128, 118, 420, 46)],
                      style: titleStyle,
                    },
                  ],
                },
                {
                  ...bounds(128, 172, 456, 46),
                  text: "Catch baked fallbacks",
                  baselineY: 208,
                  runs: [
                    {
                      text: "Catch baked ",
                      bounds: bounds(128, 172, 236, 46),
                      boxes: [bounds(128, 172, 236, 46)],
                      style: titleStyle,
                    },
                    {
                      text: "fallbacks",
                      bounds: bounds(364, 172, 220, 46),
                      boxes: [bounds(364, 172, 220, 46)],
                      style: { ...titleStyle, color: "2563EB" },
                    },
                  ],
                },
              ],
              grouping: {
                strategy: "nearest-semantic-text-container",
                runCount: 3,
                lineCount: 2,
                textNodeCount: 3,
                segmentCount: 3,
              },
            },
          },
          {
            id: "body-copy",
            type: MANIFEST_ELEMENT_TYPES.TEXT,
            role: "body",
            groupId: "body-copy",
            bounds: bounds(128, 250, 560, 78),
            text: {
              content: "Validate repair-safe packages\nand coherent editable text.",
              style: bodyStyle,
              paragraph: {
                align: "left",
                verticalAlign: "top",
                wrap: "none",
                margins: { leftPx: 0, topPx: 0, rightPx: 0, bottomPx: 0 },
              },
              runs: [],
              lines: [
                {
                  ...bounds(128, 250, 386, 30),
                  text: "Validate repair-safe packages",
                  baselineY: 274,
                  runs: [
                    {
                      text: "Validate repair-safe packages",
                      bounds: bounds(128, 250, 386, 30),
                      boxes: [bounds(128, 250, 386, 30)],
                      style: bodyStyle,
                    },
                  ],
                },
                {
                  ...bounds(128, 288, 336, 30),
                  text: "and coherent editable text.",
                  baselineY: 312,
                  runs: [
                    {
                      text: "and coherent editable text.",
                      bounds: bounds(128, 288, 336, 30),
                      boxes: [bounds(128, 288, 336, 30)],
                      style: bodyStyle,
                    },
                  ],
                },
              ],
              grouping: {
                strategy: "nearest-semantic-text-container",
                runCount: 2,
                lineCount: 2,
                textNodeCount: 2,
                segmentCount: 2,
              },
            },
          },
          {
            id: "divider-line",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.BORDER_OR_LINE,
            bounds: bounds(128, 350, 620, 2),
            shapeStyle: {
              fill: { color: "D1D5DB", opacity: 1 },
              stroke: { color: "D1D5DB", widthPx: 2 },
            },
          },
          {
            id: "cta-button",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.BUTTON_OR_BADGE,
            bounds: bounds(128, 374, 198, 48),
            shapeStyle: {
              fill: { color: "2563EB", opacity: 1 },
              stroke: { color: "1D4ED8", widthPx: 1 },
              radius: { radiusPx: 24 },
            },
          },
          {
            id: "cta-label",
            type: MANIFEST_ELEMENT_TYPES.TEXT,
            role: "button-label",
            groupId: "cta-button",
            bounds: bounds(158, 386, 138, 24),
            text: {
              content: "Run gates",
              style: buttonStyle,
              paragraph: {
                align: "center",
                verticalAlign: "middle",
                wrap: "none",
                margins: { leftPx: 0, topPx: 0, rightPx: 0, bottomPx: 0 },
              },
              runs: [
                {
                  text: "Run gates",
                  bounds: bounds(158, 386, 138, 24),
                  boxes: [bounds(158, 386, 138, 24)],
                  style: buttonStyle,
                },
              ],
              lines: [
                {
                  ...bounds(158, 386, 138, 24),
                  text: "Run gates",
                  baselineY: 405,
                },
              ],
            },
          },
          {
            id: "progress-fill",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.PROGRESS_BAR,
            bounds: bounds(360, 394, 280, 10),
            shapeStyle: {
              fill: { color: "2DBE6C", opacity: 1 },
              stroke: { color: null, widthPx: 0 },
              radius: { radiusPx: 5 },
            },
          },
          {
            id: "microsoft-logo",
            type: MANIFEST_ELEMENT_TYPES.IMAGE,
            classification: NATIVE_OBJECT_KINDS.MICROSOFT_OR_ACCOUNT_LOGO,
            bounds: bounds(1670, 64, 72, 72),
            src: "assets/microsoft.svg",
            alt: "Microsoft",
            nativeAsset: true,
          },
          {
            id: "bounded-canvas",
            type: MANIFEST_ELEMENT_TYPES.FALLBACK,
            classification: RASTER_FALLBACK_KINDS.CANVAS_OR_WEBGL,
            kind: RASTER_FALLBACK_KINDS.CANVAS_OR_WEBGL,
            bounds: bounds(980, 190, 520, 320),
            containsVisibleText: false,
            reason: "Canvas demo cannot be decomposed into native Office geometry.",
            assetRef: {
              id: "bounded-canvas-raster",
              kind: MANIFEST_ELEMENT_TYPES.IMAGE,
              href: onePixelPng,
              mimeType: "image/png",
              altText: "Bounded canvas fallback",
              intrinsic: { width: 1, height: 1 },
            },
            image: { fit: "stretch" },
          },
        ],
      },
    ],
  });
}

function reportForManifest(manifest, pptxOutput = "fixtures/native-quality.pptx") {
  return buildExportContractReport({
    slides: manifest.slides,
    mode: manifest.mode,
    pdfOutput: "fixtures/native-quality.pdf",
    pptxOutput,
  });
}

test("native quality gates validate generated PPTX package and report metrics", async () => {
  await rm(outputDir, { recursive: true, force: true });
  const manifest = nativeQualityFixture();
  const outputPath = path.join(outputDir, "native-quality-gates.pptx");

  try {
    await writePptx({
      outputPath,
      slides: manifest.slides,
      mode: EXPORT_MODES.NATIVE_EDITABLE,
    });
    const packageInspection = await inspectPptxPackage(outputPath);
    const report = reportForManifest(manifest, outputPath);
    const gateResult = assertNativeQualityGates({
      mode: EXPORT_MODES.NATIVE_EDITABLE,
      report,
      packageInspection,
      expectedNativeKinds: [
        NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        NATIVE_OBJECT_KINDS.CARD_OR_BOX,
        NATIVE_OBJECT_KINDS.BORDER_OR_LINE,
        NATIVE_OBJECT_KINDS.BUTTON_OR_BADGE,
        NATIVE_OBJECT_KINDS.PROGRESS_BAR,
        NATIVE_OBJECT_KINDS.MICROSOFT_OR_ACCOUNT_LOGO,
      ],
      expectedSemanticTextBoxes: 3,
      minAverageLinesPerTextBox: 1.6,
      minEditabilityScore: 0.85,
    });
    const reportJson = JSON.stringify(report);

    assert.equal(packageInspection.valid, true);
    assert.equal(packageInspection.totals.fullSlideRasterPictures, 0);
    assert.equal(packageInspection.totals.hiddenTextRuns, 0);
    assert.equal(packageInspection.totals.textBoxes, 3);
    assert.equal(packageInspection.totals.wrapNoneTextBoxes, 3);
    assert.equal(packageInspection.totals.noAutofitTextBoxes, 3);
    assert.equal(packageInspection.totals.wrapSquareTextBoxes, 0);
    assert.equal(packageInspection.totals.normalAutofitTextBoxes, 0);
    assert.ok(packageInspection.totals.shapes >= 3);
    assert.ok(packageInspection.totals.connectors >= 1);
    assert.ok(packageInspection.totals.groupShapes >= 1);
    assert.equal(report.duplicateBakedVisibleTextRegions, 0);
    assert.equal(report.forbiddenDuplicateBakedVisibleText, false);
    assert.equal(report.forbiddenFallbackRasterRegions, 0);
    assert.equal(report.fallbackRasterRegions, 1);
    assert.equal(report.fallbackRasterAreaPx, 166400);
    assert.equal(
      report.fallbackRasterReasons[0].reason,
      "Canvas demo cannot be decomposed into native Office geometry.",
    );
    assert.match(reportJson, /"editabilityScore":/);
    assert.match(reportJson, /"nativeObjectCounts":/);
    assert.match(reportJson, /"fallbackRasterAreaPx":166400/);
    assert.match(reportJson, /"fallbackRasterReasons":/);
    assert.equal(gateResult.valid, true);
    assert.equal(gateResult.fallbackRasterAreaPx, 166400);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("native quality gates reject repair-prone full-slide raster and duplicate text states", async () => {
  const fallback = createRasterFallbackRegion({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    kind: RASTER_FALLBACK_KINDS.DEBUG_FULL_SLIDE_SCREENSHOT,
    width: 1920,
    height: 1080,
    containsVisibleText: true,
    coversFullSlide: true,
    reason: "bad native fallback",
  });
  const report = buildExportContractReport({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        index: 0,
        texts: [
          {
            text: "Editable title",
            textLines: [{ text: "Editable title" }],
            textRuns: [{ text: "Editable title" }],
          },
        ],
        nativeObjects: [{ kind: NATIVE_OBJECT_KINDS.CARD_OR_BOX }],
        rasterFallbackRegions: [fallback],
      },
    ],
  });

  assert.throws(
    () =>
      assertNativeQualityGates({
        mode: EXPORT_MODES.NATIVE_EDITABLE,
        report,
        packageInspection: {
          valid: true,
          errors: [],
          totals: {
            textBoxes: 1,
            shapes: 1,
            connectors: 0,
            pictures: 1,
            groupShapes: 0,
            fullSlideRasterPictures: 1,
            hiddenTextRuns: 0,
          },
        },
        expectedNativeKinds: [NATIVE_OBJECT_KINDS.VISIBLE_TEXT],
      }),
    /full-slide raster fallback|duplicate baked text|forbidden fallbacks/,
  );
});

test("debug fidelity mode is the only quality-gate path that allows full-slide raster", async () => {
  await rm(outputDir, { recursive: true, force: true });
  const outputPath = path.join(outputDir, "debug-fidelity-quality.pptx");
  const slide = {
    index: 0,
    width: 1920,
    height: 1080,
    backgroundPng: Buffer.from("debug raster payload"),
    texts: [
      {
        text: "Invisible debug overlay",
        x: 120,
        y: 120,
        width: 520,
        height: 80,
        fontFace: "Segoe UI",
        fontSizePx: 32,
        fontSizePt: 24,
        color: "111827",
      },
    ],
    nativeObjects: [{ kind: NATIVE_OBJECT_KINDS.CARD_OR_BOX }],
  };

  try {
    await writePptx({
      outputPath,
      slides: [slide],
      mode: EXPORT_MODES.DEBUG_FIDELITY,
    });
    const packageInspection = await inspectPptxPackage(outputPath);
    const report = buildExportContractReport({
      mode: EXPORT_MODES.DEBUG_FIDELITY,
      slides: [
        {
          ...slide,
          rasterFallbackRegions: [createDebugFullSlideFallback(slide)],
        },
      ],
    });

    assert.equal(packageInspection.totals.fullSlideRasterPictures, 1);
    assert.equal(packageInspection.totals.hiddenTextRuns, 1);
    assert.doesNotThrow(() =>
      assertNativeQualityGates({
        mode: EXPORT_MODES.DEBUG_FIDELITY,
        report,
        packageInspection,
        expectedNativeKinds: [
          NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
          NATIVE_OBJECT_KINDS.CARD_OR_BOX,
        ],
      }),
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("package inspection catches missing relationship targets before PowerPoint repair", async () => {
  await rm(outputDir, { recursive: true, force: true });
  const manifest = nativeQualityFixture();
  const outputPath = path.join(outputDir, "relationship-targets.pptx");

  try {
    await writePptx({
      outputPath,
      slides: manifest.slides,
      mode: EXPORT_MODES.NATIVE_EDITABLE,
    });
    const zip = await JSZip.loadAsync(await readFile(outputPath));
    const relsPart = "ppt/slides/_rels/slide1.xml.rels";
    const relsXml = await zip.file(relsPart).async("string");
    zip.file(relsPart, relsXml.replace("../media/image-1-1.png", "../media/missing-1.png"));
    const corrupted = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const inspection = await inspectPptxPackage(corrupted);

    assert.equal(inspection.valid, false);
    assert.ok(
      inspection.errors.some((error) =>
        error.includes("targets missing part ../media/missing-1.png"),
      ),
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

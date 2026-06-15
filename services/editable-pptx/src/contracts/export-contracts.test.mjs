import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDITABLE_PPTX_PIPELINE_CONTRACT,
  EXPORT_ARTIFACTS,
  EXPORT_REPORT_ARTIFACTS,
  EXPORT_REQUEST_CONTRACT,
  EXPORT_RESPONSE_CONTRACT,
  EXPORT_TIMEOUTS,
  IMAGE_PPTX_PIPELINE_CONTRACT,
  isSavedArtifactMetadata,
  savedArtifactMetadata,
} from "./export-contracts.mjs";
import {
  DEFAULT_EXPORT_MODE,
  EXPORT_MODES,
  NATIVE_OBJECT_KINDS,
  RASTER_FALLBACK_KINDS,
  buildExportContractReport,
  createRasterFallbackRegion,
} from "./native-editable-contract.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

function readRepoFile(...parts) {
  return readFile(path.join(repoRoot, ...parts), "utf8");
}

test("artifact contracts freeze request and response shapes", () => {
  assert.deepEqual(EXPORT_REQUEST_CONTRACT, {
    method: "POST",
    contentType: "application/json",
    body: {
      url: "string",
      mode: "native-editable | debug-fidelity | undefined",
    },
  });
  assert.deepEqual(EXPORT_RESPONSE_CONTRACT.savedArtifactMetadata, {
    filename: "string",
    path: "exports/<filename>",
  });
  assert.equal(
    EXPORT_RESPONSE_CONTRACT.clientUnion,
    "SavedExportResult | FileExportResult",
  );

  const editableMetadata = savedArtifactMetadata(EXPORT_ARTIFACTS.editablePptx);
  assert.deepEqual(editableMetadata, {
    filename: "webslides.pptx",
    path: "exports/webslides.pptx",
  });
  assert.equal(
    isSavedArtifactMetadata(editableMetadata, EXPORT_ARTIFACTS.editablePptx),
    true,
  );
  assert.deepEqual(EXPORT_REPORT_ARTIFACTS.editablePptx, {
    id: "editable-pptx-report",
    filename: "webslides.pptx.report.json",
    relativePath: "exports/webslides.pptx.report.json",
    generatedByDefault: true,
    returnedFromApi: false,
    metrics: [
      "contractVersion",
      "mode",
      "slideCount",
      "editableTextBoxes",
      "editableTextLines",
      "editableTextRuns",
      "nativeObjects",
      "nativeObjectCounts",
      "fallbackRasterRegions",
      "fallbackRasterAreaPx",
      "fallbackRasterRegionCounts",
      "fallbackRasterReasons",
      "forbiddenFallbackRasterRegions",
      "duplicateBakedVisibleTextRegions",
      "editabilityScore",
    ],
  });
});

test("editable PPTX contract requires PDF artifact before PPTX writing", async () => {
  assert.equal(
    EDITABLE_PPTX_PIPELINE_CONTRACT.mustGeneratePdfArtifactBeforePptx,
    true,
  );
  assert.deepEqual(EDITABLE_PPTX_PIPELINE_CONTRACT.orderedStages, [
    "pdf-artifact",
    "capture-rendered-export-pages-as-native-model",
    "write-pptx",
  ]);
  assert.equal(
    EDITABLE_PPTX_PIPELINE_CONTRACT.defaultMode,
    DEFAULT_EXPORT_MODE,
  );
  assert.equal(
    EDITABLE_PPTX_PIPELINE_CONTRACT.debugFidelityFallbackMode,
    EXPORT_MODES.DEBUG_FIDELITY,
  );
  assert.equal(
    EDITABLE_PPTX_PIPELINE_CONTRACT.reportArtifact.relativePath,
    "exports/webslides.pptx.report.json",
  );
  assert.equal(
    EDITABLE_PPTX_PIPELINE_CONTRACT.reportArtifact.generatedByDefault,
    true,
  );
  assert.equal(
    EDITABLE_PPTX_PIPELINE_CONTRACT.nativeEditableMode
      .forbiddenDuplicateBakedVisibleText,
    true,
  );
  assert.ok(
    EDITABLE_PPTX_PIPELINE_CONTRACT.nativeEditableMode.requiredNativeObjects.some(
      (item) => item.kind === NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
    ),
  );

  const cli = await readRepoFile(
    "services",
    "editable-pptx",
    "src",
    "cli",
    "export-editable-pptx.mjs",
  );
  const pdfIndex = cli.indexOf("await runPdfExport");
  const captureIndex = cli.indexOf("await captureDeck");
  const writeIndex = cli.indexOf("await writePptx");

  assert.ok(pdfIndex > -1, "editable CLI must call runPdfExport");
  assert.ok(captureIndex > -1, "editable CLI must capture the rendered deck");
  assert.ok(writeIndex > -1, "editable CLI must write a PPTX");
  assert.ok(
    pdfIndex < captureIndex,
    "PDF artifact must be generated before capture",
  );
  assert.ok(
    captureIndex < writeIndex,
    "PPTX writing must happen after capture",
  );
  assert.match(cli, /export-pdf\.mjs/);
  assert.match(cli, /EXPORT_TIMEOUTS\.cliMilliseconds\.pdfArtifact/);
  assert.match(cli, /--mode/);
  assert.match(cli, /defaultReportOutput/);
  assert.match(cli, /--no-report/);
  assert.match(cli, /Export report: \$\{reportOutput\}/);
  assert.match(
    EDITABLE_PPTX_PIPELINE_CONTRACT.metrics,
    /nativeObjectCounts[\s\S]*fallbackRasterAreaPx[\s\S]*fallbackRasterReasons/,
  );
});

test("native editable contract reports forbidden duplicate baked text", () => {
  const fallback = createRasterFallbackRegion({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    kind: RASTER_FALLBACK_KINDS.DEBUG_FULL_SLIDE_SCREENSHOT,
    width: 1920,
    height: 1080,
    containsVisibleText: true,
    coversFullSlide: true,
    reason: "contract test",
  });
  const report = buildExportContractReport({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        index: 0,
        texts: [
          {
            text: "Native text",
            textLines: [{ text: "Native text" }],
            textRuns: [{ text: "Native text" }],
          },
        ],
        nativeObjects: [{ kind: NATIVE_OBJECT_KINDS.CARD_OR_BOX }],
        rasterFallbackRegions: [fallback],
      },
    ],
  });

  assert.equal(report.mode, EXPORT_MODES.NATIVE_EDITABLE);
  assert.equal(report.forbiddenDuplicateBakedVisibleText, true);
  assert.equal(report.editableTextLines, 1);
  assert.equal(report.editableTextRuns, 1);
  assert.equal(report.nativeObjects, 2);
  assert.equal(report.nativeObjectCounts[NATIVE_OBJECT_KINDS.VISIBLE_TEXT], 1);
  assert.equal(report.nativeObjectCounts[NATIVE_OBJECT_KINDS.CARD_OR_BOX], 1);
  assert.equal(report.forbiddenFallbackRasterRegions, 1);
  assert.equal(report.duplicateBakedVisibleTextRegions, 1);
  assert.equal(report.fallbackRasterAreaPx, 2073600);
  assert.equal(
    report.fallbackRasterRegionCounts[
      RASTER_FALLBACK_KINDS.DEBUG_FULL_SLIDE_SCREENSHOT
    ],
    1,
  );
  assert.equal(report.fallbackRasterReasons[0].coversFullSlide, true);
  assert.ok(report.editabilityScore < 1);
  assert.equal(Object.isFrozen(report.requiredNativeObjects[0]), true);
});

test("FastAPI routes keep local metadata and production file responses", async () => {
  const server = await readRepoFile("server", "src", "router", "exports.py");

  assert.match(
    server,
    /@router\.post\("\/pptx\/editable"\)[\s\S]*return saved_export_response\(EDITABLE_PPTX_PATH\)/,
  );
  assert.match(
    server,
    /EDITABLE_PPTX_REPORT_PATH = EXPORTS_DIR \/ "webslides\.pptx\.report\.json"/,
  );
  assert.match(
    server,
    /@router\.post\("\/pptx\/editable"\)[\s\S]*extra_args=editable_pptx_args\(mode, EDITABLE_PPTX_REPORT_PATH\)/,
  );
  assert.match(
    server,
    /@router\.post\("\/pptx\/editable\/download"\)[\s\S]*script_name="export:pptx"[\s\S]*timeout=300[\s\S]*extra_args=editable_pptx_args\(mode\)/,
  );
  assert.match(
    server,
    /@router\.post\("\/pptx\/image"\)[\s\S]*return saved_export_response\(IMAGE_PPTX_PATH\)/,
  );
  assert.match(
    server,
    /@router\.post\("\/pptx\/image\/download"\)[\s\S]*script_name="export:pptx-img"[\s\S]*timeout=240/,
  );
  assert.match(
    server,
    /@router\.post\("\/pptx"\)[\s\S]*return export_image_pptx\(request\)/,
  );
  assert.match(server, /return FileResponse\(/);
  assert.match(server, /except subprocess\.TimeoutExpired/);
  assert.match(server, /status_code=504/);
  assert.match(server, /timed out while rendering the deck/);
});

test("client API and UI preserve the saved-or-downloaded PPTX union", async () => {
  const api = await readRepoFile("src", "lib", "api.ts");
  const dialog = await readRepoFile(
    "src",
    "components",
    "ui",
    "export-dialog.tsx",
  );

  assert.match(
    api,
    /export interface SavedExportResult \{[\s\S]*filename: string;[\s\S]*path: string;[\s\S]*\}/,
  );
  assert.match(
    api,
    /export interface FileExportResult \{[\s\S]*blob: Blob;[\s\S]*filename: string;[\s\S]*\}/,
  );
  assert.match(api, /export type SavedOrDownloadedExportResult/);
  assert.match(
    api,
    /const exportPath = options\.downloadOnly \? `\$\{path\}\/download` : path;/,
  );
  assert.match(
    api,
    /if \(isJsonResponse\(response\)\) \{[\s\S]*return \(await response\.json\(\)\) as SavedExportResult;/,
  );
  assert.match(api, /"\/exports\/pptx\/editable"/);
  assert.match(api, /"\/exports\/pptx\/image"/);
  assert.match(api, /mode: options\.mode \?\? "native-editable"/);

  assert.match(dialog, /buttonLabel="Export Editable PPTX"/);
  assert.match(dialog, /downloadOnly: !savesLocalArtifacts/);
  assert.match(dialog, /mode: "native-editable"/);
  assert.match(dialog, /Saved \$\{result\.path\}/);
  assert.match(dialog, /webslides\.pptx\.report\.json/);
  assert.match(dialog, /Downloaded \$\{result\.filename\}/);
});

test("image PPTX remains the faithful raster fallback", async () => {
  assert.equal(IMAGE_PPTX_PIPELINE_CONTRACT.rasterFallback, true);
  assert.equal(IMAGE_PPTX_PIPELINE_CONTRACT.editableNativeObjects, false);

  const imageScript = await readRepoFile("scripts", "export-pptx-img.mjs");
  assert.match(
    imageScript,
    /page\.locator\("\.pdf-export-page"\)\.elementHandles\(\)/,
  );
  assert.match(imageScript, /slidePage\.screenshot\(\{ type: "png" \}\)/);
  assert.match(
    imageScript,
    /slide\.addImage\(\{[\s\S]*data: `data:image\/png;base64/,
  );
  assert.match(imageScript, /waitForExportSettled\(page, "Image PPTX"\)/);
});

test("timeout contracts remain explicit", async () => {
  assert.deepEqual(EXPORT_TIMEOUTS.serverSeconds, {
    pdf: 120,
    editablePptx: 300,
    imagePptx: 240,
  });
  assert.deepEqual(EXPORT_TIMEOUTS.cliMilliseconds, {
    pdfArtifact: 240000,
    browserReady: 30000,
    exportSettled: 30000,
  });

  const capture = await readRepoFile(
    "services",
    "editable-pptx",
    "src",
    "capture",
    "capture-deck.mjs",
  );
  const pdfScript = await readRepoFile("scripts", "export-pdf.mjs");

  assert.match(capture, /EXPORT_TIMEOUTS\.cliMilliseconds\.browserReady/);
  assert.match(capture, /EXPORT_TIMEOUTS\.cliMilliseconds\.exportSettled/);
  assert.match(
    pdfScript,
    /\$\{exportLabel\} export did not settle before capture/,
  );
  assert.match(pdfScript, /\{ timeout: 30000 \}/);
});

test("capture contract emits typed native DOM manifest primitives", async () => {
  const capture = await readRepoFile(
    "services",
    "editable-pptx",
    "src",
    "capture",
    "capture-deck.mjs",
  );

  assert.match(capture, /function classifyNativeElement/);
  assert.match(capture, /function collectShapeObjects/);
  assert.match(capture, /function collectBorderLineObjects/);
  assert.match(capture, /function collectFallbackObjects/);
  assert.match(capture, /function attachRasterPayloads/);
  assert.match(capture, /rasterizedFallback/);
  assert.match(capture, /function logoClassification/);
  assert.match(capture, /nearest-semantic-text-container/);
  assert.match(capture, /function buildTextLines/);
  assert.match(capture, /function calibratedFontSizePt/);
  assert.match(capture, /suppressScreenshotFallback/);
  assert.match(capture, /nativeAsset/);
});

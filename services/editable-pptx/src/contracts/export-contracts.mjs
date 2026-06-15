import {
  ACCEPTANCE_CRITERIA,
  ALLOWED_RASTER_FALLBACK_REGIONS,
  CONTRACT_RULES,
  DEFAULT_EXPORT_MODE,
  EXPORT_MODES,
  REQUIRED_NATIVE_OBJECTS,
} from "./native-editable-contract.mjs";

const PDF_MEDIA_TYPE = "application/pdf";
const PPTX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function deepFreeze(value) {
  Object.freeze(value);

  for (const child of Object.values(value)) {
    if (
      child &&
      (typeof child === "object" || typeof child === "function") &&
      !Object.isFrozen(child)
    ) {
      deepFreeze(child);
    }
  }

  return value;
}

export const EXPORT_ARTIFACTS = deepFreeze({
  pdf: {
    id: "pdf",
    filename: "webslides.pdf",
    relativePath: "exports/webslides.pdf",
    mediaType: PDF_MEDIA_TYPE,
    scriptName: "export:pdf",
    localEndpoint: "/exports/pdf",
    downloadEndpoint: "/exports/pdf/download",
    localResponse: "file",
    downloadResponse: "file",
  },
  editablePptx: {
    id: "editable-pptx",
    filename: "webslides.pptx",
    relativePath: "exports/webslides.pptx",
    mediaType: PPTX_MEDIA_TYPE,
    scriptName: "export:pptx",
    localEndpoint: "/exports/pptx/editable",
    downloadEndpoint: "/exports/pptx/editable/download",
    localResponse: "saved-artifact-metadata",
    downloadResponse: "file",
  },
  imagePptx: {
    id: "image-pptx",
    filename: "webslides-img.pptx",
    relativePath: "exports/webslides-img.pptx",
    mediaType: PPTX_MEDIA_TYPE,
    scriptName: "export:pptx-img",
    localEndpoint: "/exports/pptx/image",
    downloadEndpoint: "/exports/pptx/image/download",
    localResponse: "saved-artifact-metadata",
    downloadResponse: "file",
  },
});

export const EXPORT_REPORT_ARTIFACTS = deepFreeze({
  editablePptx: {
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
  },
});

export const EXPORT_REQUEST_CONTRACT = deepFreeze({
  method: "POST",
  contentType: "application/json",
  body: {
    url: "string",
    mode: `${EXPORT_MODES.NATIVE_EDITABLE} | ${EXPORT_MODES.DEBUG_FIDELITY} | undefined`,
  },
});

export const EXPORT_RESPONSE_CONTRACT = deepFreeze({
  savedArtifactMetadata: {
    filename: "string",
    path: "exports/<filename>",
  },
  file: {
    body: "binary",
    filenameSource: "Content-Disposition filename",
  },
  clientUnion: "SavedExportResult | FileExportResult",
});

export const EXPORT_TIMEOUTS = deepFreeze({
  serverSeconds: {
    pdf: 120,
    editablePptx: 300,
    imagePptx: 240,
  },
  cliMilliseconds: {
    pdfArtifact: 240000,
    browserReady: 30000,
    exportSettled: 30000,
  },
});

export const EDITABLE_PPTX_PIPELINE_CONTRACT = deepFreeze({
  defaultMode: DEFAULT_EXPORT_MODE,
  debugFidelityFallbackMode: EXPORT_MODES.DEBUG_FIDELITY,
  reportArtifact: EXPORT_REPORT_ARTIFACTS.editablePptx,
  orderedStages: [
    "pdf-artifact",
    "capture-rendered-export-pages-as-native-model",
    "write-pptx",
  ],
  mustGeneratePdfArtifactBeforePptx: true,
  nativeEditableMode: {
    visibleText: "native-visible-text",
    forbiddenDuplicateBakedVisibleText:
      CONTRACT_RULES.forbiddenDuplicateBakedVisibleText,
    requiredNativeObjects: REQUIRED_NATIVE_OBJECTS,
    rasterFallbackPolicy: CONTRACT_RULES.defaultModeRasterFallbackPolicy,
    allowedRasterFallbackKinds: ALLOWED_RASTER_FALLBACK_REGIONS,
  },
  debugFidelityFallbackModeContract: {
    type: "full-slide-raster-with-invisible-editable-text-overlay",
    policy: CONTRACT_RULES.debugFidelityFallbackPolicy,
  },
  acceptanceCriteria: ACCEPTANCE_CRITERIA,
  metrics:
    "contractVersion, mode, slideCount, editableTextBoxes, editableTextLines, editableTextRuns, nativeObjects, nativeObjectCounts, fallbackRasterRegions, fallbackRasterAreaPx, fallbackRasterRegionCounts, fallbackRasterReasons, forbiddenFallbackRasterRegions, duplicateBakedVisibleTextRegions, editabilityScore",
  nativeExportCompatibility: {
    mustKeepUrlRequestField: true,
    mayAddOptionalModeField: true,
    mustKeepSavedOrDownloadedResponseShape: true,
    mustKeepRoutePaths: true,
  },
});

export const IMAGE_PPTX_PIPELINE_CONTRACT = deepFreeze({
  orderedStages: [
    "capture-rendered-export-pages",
    "screenshot-each-page",
    "write-image-pptx",
  ],
  rasterFallback: true,
  visualFidelityPolicy: "faithful snapshot of the live web deck",
  editableNativeObjects: false,
});

export function savedArtifactMetadata(artifact) {
  return {
    filename: artifact.filename,
    path: artifact.relativePath,
  };
}

export function isSavedArtifactMetadata(value, artifact) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.filename === artifact.filename &&
    value.path === artifact.relativePath
  );
}

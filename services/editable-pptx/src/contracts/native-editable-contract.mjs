export const NATIVE_EDITABLE_CONTRACT_VERSION = "2026-01-01";

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

export const EXPORT_MODES = deepFreeze({
  NATIVE_EDITABLE: "native-editable",
  DEBUG_FIDELITY: "debug-fidelity",
});

export const DEFAULT_EXPORT_MODE = EXPORT_MODES.NATIVE_EDITABLE;

export const NATIVE_OBJECT_KINDS = deepFreeze({
  VISIBLE_TEXT: "visible-text",
  CARD_OR_BOX: "card-or-box",
  BORDER_OR_LINE: "border-or-line",
  BUTTON_OR_BADGE: "button-or-badge",
  PROGRESS_BAR: "progress-bar",
  MICROSOFT_OR_ACCOUNT_LOGO: "microsoft-or-account-logo",
  SIMPLE_SVG_OR_ICON: "simple-svg-or-icon",
});

export const REQUIRED_NATIVE_OBJECTS = deepFreeze([
  {
    kind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
    requiredInDefaultMode: true,
    acceptance:
      "Visible slide text selects as PowerPoint text and can be edited without exposing duplicate baked text underneath.",
  },
  {
    kind: NATIVE_OBJECT_KINDS.CARD_OR_BOX,
    requiredInDefaultMode: true,
    acceptance:
      "Cards, panels, and boxes select as PowerPoint shapes with editable fill, outline, size, and position.",
  },
  {
    kind: NATIVE_OBJECT_KINDS.BORDER_OR_LINE,
    requiredInDefaultMode: true,
    acceptance:
      "Borders, dividers, and rules select as PowerPoint lines or shape outlines and can be restyled.",
  },
  {
    kind: NATIVE_OBJECT_KINDS.BUTTON_OR_BADGE,
    requiredInDefaultMode: true,
    acceptance:
      "Buttons, pills, and badges select as native PowerPoint shapes with separate editable text.",
  },
  {
    kind: NATIVE_OBJECT_KINDS.PROGRESS_BAR,
    requiredInDefaultMode: true,
    acceptance:
      "Progress bars select as native PowerPoint rectangles whose fill and length can be edited.",
  },
  {
    kind: NATIVE_OBJECT_KINDS.MICROSOFT_OR_ACCOUNT_LOGO,
    requiredInDefaultMode: true,
    acceptance:
      "Microsoft and account logos are native PowerPoint vector/picture objects when source assets make that feasible.",
  },
  {
    kind: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
    requiredInDefaultMode: true,
    acceptance:
      "Simple SVGs and icons are emitted as editable PowerPoint geometry where feasible; otherwise they must be isolated raster fallbacks.",
  },
]);

export const RASTER_FALLBACK_KINDS = deepFreeze({
  PHOTO_OR_COMPLEX_IMAGE: "photo-or-complex-image",
  VIDEO_FRAME: "video-frame",
  CANVAS_OR_WEBGL: "canvas-or-webgl",
  COMPLEX_SVG_OR_ICON: "complex-svg-or-icon",
  COMPLEX_EFFECT_REGION: "complex-css-effect-region",
  COMPLEX_CHART_OR_DATA_VIZ: "complex-chart-or-data-visualization",
  DEBUG_FULL_SLIDE_SCREENSHOT: "debug-full-slide-screenshot",
});

export const ALLOWED_RASTER_FALLBACK_REGIONS = deepFreeze([
  RASTER_FALLBACK_KINDS.PHOTO_OR_COMPLEX_IMAGE,
  RASTER_FALLBACK_KINDS.VIDEO_FRAME,
  RASTER_FALLBACK_KINDS.CANVAS_OR_WEBGL,
  RASTER_FALLBACK_KINDS.COMPLEX_SVG_OR_ICON,
  RASTER_FALLBACK_KINDS.COMPLEX_EFFECT_REGION,
  RASTER_FALLBACK_KINDS.COMPLEX_CHART_OR_DATA_VIZ,
]);

export const CONTRACT_RULES = deepFreeze({
  defaultMode: DEFAULT_EXPORT_MODE,
  fallbackMode: EXPORT_MODES.DEBUG_FIDELITY,
  forbiddenDuplicateBakedVisibleText: true,
  defaultModeRasterFallbackPolicy:
    "Raster fallbacks must be bounded to the smallest complex non-text region and must not contain visible text that also exists as editable text.",
  debugFidelityFallbackPolicy:
    "Debug/fidelity mode may include a full-slide raster visual layer for comparison, with editable text as an invisible overlay. It is not the default editable contract.",
});

export const ACCEPTANCE_CRITERIA = deepFreeze([
  {
    id: "visible-text-is-native",
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    statement:
      "In PowerPoint, selecting any visible text selects a native text box, not an image.",
  },
  {
    id: "no-duplicate-baked-visible-text",
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    statement:
      "Deleting or editing a text box must not reveal a duplicate raster copy of the same visible text.",
  },
  {
    id: "chrome-is-native",
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    statement:
      "Cards, boxes, borders, lines, buttons, badges, and progress bars are editable PowerPoint shapes.",
  },
  {
    id: "logos-and-simple-icons-native-when-feasible",
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    statement:
      "Microsoft/account logos and simple SVG/icon assets are native vector/picture objects when feasible, otherwise isolated raster fallbacks are reported.",
  },
  {
    id: "fallbacks-are-measured",
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    statement:
      "Every raster fallback region is reported with kind, bounds, text containment, allowed/forbidden status, and reason.",
  },
  {
    id: "debug-mode-is-explicit",
    mode: EXPORT_MODES.DEBUG_FIDELITY,
    statement:
      "Full-slide screenshots are only allowed in explicit debug-fidelity mode and must be reported as such.",
  },
]);

export function normalizeExportMode(mode = DEFAULT_EXPORT_MODE) {
  if (mode === "debug" || mode === "fidelity" || mode === "debug-fallback") {
    return EXPORT_MODES.DEBUG_FIDELITY;
  }

  if (mode === "native" || mode === "editable") {
    return EXPORT_MODES.NATIVE_EDITABLE;
  }

  if (Object.values(EXPORT_MODES).includes(mode)) {
    return mode;
  }

  throw new Error(
    `Unknown editable PPTX export mode "${mode}". Expected ${Object.values(
      EXPORT_MODES,
    ).join(" or ")}.`,
  );
}

export function isDebugFidelityMode(mode) {
  return normalizeExportMode(mode) === EXPORT_MODES.DEBUG_FIDELITY;
}

export function isAllowedRasterFallback({
  mode = DEFAULT_EXPORT_MODE,
  kind,
  containsVisibleText = false,
  coversFullSlide = false,
}) {
  const normalizedMode = normalizeExportMode(mode);

  if (normalizedMode === EXPORT_MODES.DEBUG_FIDELITY) {
    return true;
  }

  if (coversFullSlide || containsVisibleText) {
    return false;
  }

  return ALLOWED_RASTER_FALLBACK_REGIONS.includes(kind);
}

export function createRasterFallbackRegion({
  mode = DEFAULT_EXPORT_MODE,
  kind,
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  containsVisibleText = false,
  coversFullSlide = false,
  reason,
}) {
  const normalizedMode = normalizeExportMode(mode);
  return {
    kind,
    x,
    y,
    width,
    height,
    containsVisibleText,
    coversFullSlide,
    allowed: isAllowedRasterFallback({
      mode: normalizedMode,
      kind,
      containsVisibleText,
      coversFullSlide,
    }),
    reason,
  };
}

export function createDebugFullSlideFallback(slide) {
  return createRasterFallbackRegion({
    mode: EXPORT_MODES.DEBUG_FIDELITY,
    kind: RASTER_FALLBACK_KINDS.DEBUG_FULL_SLIDE_SCREENSHOT,
    x: 0,
    y: 0,
    width: slide.width,
    height: slide.height,
    containsVisibleText: true,
    coversFullSlide: true,
    reason: CONTRACT_RULES.debugFidelityFallbackPolicy,
  });
}

function countByKind(items) {
  return items.reduce((counts, item) => {
    const kind = item.kind ?? "unknown";
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {});
}

function mergeCountMaps(target, source = {}) {
  for (const [kind, count] of Object.entries(source)) {
    target[kind] = (target[kind] ?? 0) + count;
  }

  return target;
}

function fallbackArea(region = {}) {
  return Math.max(0, Number(region.width) || 0) *
    Math.max(0, Number(region.height) || 0);
}

function fallbackReason(region = {}) {
  return {
    id: region.id,
    kind: region.kind ?? "unknown",
    allowed: Boolean(region.allowed),
    areaPx: Number(fallbackArea(region).toFixed(3)),
    containsVisibleText: Boolean(region.containsVisibleText),
    coversFullSlide: Boolean(region.coversFullSlide),
    bounds: {
      x: region.x ?? region.bounds?.x ?? 0,
      y: region.y ?? region.bounds?.y ?? 0,
      width: region.width ?? region.bounds?.width ?? 0,
      height: region.height ?? region.bounds?.height ?? 0,
    },
    reason: region.reason ?? "",
  };
}

function slideTextItems(slide) {
  if (Array.isArray(slide.elements) && slide.elements.length > 0) {
    return slide.elements
      .filter((element) => element.type === "text")
      .map((element) => ({
        text: element.text?.content ?? "",
        textLines: element.text?.lines ?? [],
        textRuns: element.text?.runs ?? [],
      }));
  }

  return slide.texts ?? [];
}

function slideNativeObjects(slide) {
  if (Array.isArray(slide.elements) && slide.elements.length > 0) {
    return slide.elements
      .map((element) => {
        if (element.type === "text") {
          return {
            kind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
            id: element.id,
            text: element.text?.content,
          };
        }

        const kind = element.nativeKind;
        if (!kind) {
          return null;
        }

        return {
          kind,
          id: element.id,
          type: element.type,
        };
      })
      .filter(Boolean);
  }

  const visibleTextObjects = (slide.texts ?? []).map((text) => ({
    kind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
    text: text.text,
  }));

  return [...(slide.nativeObjects ?? []), ...visibleTextObjects];
}

export function buildSlideContractMetrics(
  slide,
  { mode = DEFAULT_EXPORT_MODE } = {},
) {
  const normalizedMode = normalizeExportMode(mode);
  const nativeObjects = slideNativeObjects(slide);
  const textItems = slideTextItems(slide);
  const editableTextLines = textItems.reduce(
    (total, text) =>
      total +
      (text.textLines?.length ||
        text.lineBoxes?.length ||
        String(text.text ?? "").split(/\r?\n/).length ||
        1),
    0,
  );
  const editableTextRuns = textItems.reduce(
    (total, text) => total + (text.textRuns?.length || 1),
    0,
  );
  const rasterFallbackRegions = slide.rasterFallbackRegions ?? [];
  const forbiddenFallbackRegions = rasterFallbackRegions.filter(
    (region) =>
      !isAllowedRasterFallback({
        mode: normalizedMode,
        kind: region.kind,
        containsVisibleText: region.containsVisibleText,
        coversFullSlide: region.coversFullSlide,
      }),
  );
  const duplicateBakedVisibleTextRegions = rasterFallbackRegions.filter(
    (region) => region.containsVisibleText || region.coversFullSlide,
  );
  const nativeObjectCounts = countByKind(nativeObjects);
  const fallbackCounts = countByKind(rasterFallbackRegions);
  const fallbackRasterAreaPx = rasterFallbackRegions.reduce(
    (total, region) => total + fallbackArea(region),
    0,
  );
  const totalEditableObjects = nativeObjects.length;
  const totalMeasuredObjects =
    totalEditableObjects + rasterFallbackRegions.length;
  const nativeRatio =
    totalMeasuredObjects === 0
      ? 1
      : totalEditableObjects / totalMeasuredObjects;
  const duplicatePenalty =
    normalizedMode === EXPORT_MODES.NATIVE_EDITABLE
      ? duplicateBakedVisibleTextRegions.length * 0.25
      : 0;
  const forbiddenPenalty = forbiddenFallbackRegions.length * 0.2;

  return {
    index: slide.index,
    mode: normalizedMode,
    editableTextBoxes: textItems.length,
    editableTextLines,
    editableTextRuns,
    nativeObjects: totalEditableObjects,
    nativeObjectCounts,
    fallbackRasterRegionCounts: fallbackCounts,
    fallbackRasterRegions: rasterFallbackRegions.length,
    fallbackRasterAreaPx: Number(fallbackRasterAreaPx.toFixed(3)),
    fallbackRasterReasons: rasterFallbackRegions.map(fallbackReason),
    allowedFallbackRasterRegions:
      rasterFallbackRegions.length - forbiddenFallbackRegions.length,
    forbiddenFallbackRasterRegions: forbiddenFallbackRegions.length,
    duplicateBakedVisibleTextRegions: duplicateBakedVisibleTextRegions.length,
    forbidsDuplicateBakedVisibleText:
      normalizedMode === EXPORT_MODES.NATIVE_EDITABLE &&
      duplicateBakedVisibleTextRegions.length === 0,
    editabilityScore: Number(
      Math.max(
        0,
        Math.min(1, nativeRatio - duplicatePenalty - forbiddenPenalty),
      ).toFixed(3),
    ),
  };
}

export function buildExportContractReport({
  slides,
  mode = DEFAULT_EXPORT_MODE,
  pdfOutput,
  pptxOutput,
}) {
  const normalizedMode = normalizeExportMode(mode);
  const slideMetrics = slides.map((slide) =>
    buildSlideContractMetrics(slide, { mode: normalizedMode }),
  );
  const totals = slideMetrics.reduce(
    (summary, slide) => {
      summary.editableTextBoxes += slide.editableTextBoxes;
      summary.editableTextLines += slide.editableTextLines;
      summary.editableTextRuns += slide.editableTextRuns;
      summary.nativeObjects += slide.nativeObjects;
      mergeCountMaps(summary.nativeObjectCounts, slide.nativeObjectCounts);
      summary.fallbackRasterRegions += slide.fallbackRasterRegions;
      summary.fallbackRasterAreaPx += slide.fallbackRasterAreaPx;
      mergeCountMaps(
        summary.fallbackRasterRegionCounts,
        slide.fallbackRasterRegionCounts,
      );
      summary.fallbackRasterReasons.push(...slide.fallbackRasterReasons);
      summary.allowedFallbackRasterRegions +=
        slide.allowedFallbackRasterRegions;
      summary.forbiddenFallbackRasterRegions +=
        slide.forbiddenFallbackRasterRegions;
      summary.duplicateBakedVisibleTextRegions +=
        slide.duplicateBakedVisibleTextRegions;
      return summary;
    },
    {
      editableTextBoxes: 0,
      editableTextLines: 0,
      editableTextRuns: 0,
      nativeObjects: 0,
      nativeObjectCounts: {},
      fallbackRasterRegions: 0,
      fallbackRasterAreaPx: 0,
      fallbackRasterRegionCounts: {},
      fallbackRasterReasons: [],
      allowedFallbackRasterRegions: 0,
      forbiddenFallbackRasterRegions: 0,
      duplicateBakedVisibleTextRegions: 0,
    },
  );
  const editabilityScore =
    slideMetrics.length === 0
      ? 0
      : Number(
          (
            slideMetrics.reduce(
              (total, slide) => total + slide.editabilityScore,
              0,
            ) / slideMetrics.length
          ).toFixed(3),
        );

  return {
    contractVersion: NATIVE_EDITABLE_CONTRACT_VERSION,
    mode: normalizedMode,
    pdfOutput,
    pptxOutput,
    slideCount: slides.length,
    editabilityScore,
    ...totals,
    fallbackRasterAreaPx: Number(totals.fallbackRasterAreaPx.toFixed(3)),
    forbiddenDuplicateBakedVisibleText:
      normalizedMode === EXPORT_MODES.NATIVE_EDITABLE &&
      totals.duplicateBakedVisibleTextRegions > 0,
    requiredNativeObjects: REQUIRED_NATIVE_OBJECTS,
    allowedRasterFallbackKinds: ALLOWED_RASTER_FALLBACK_REGIONS,
    rules: CONTRACT_RULES,
    acceptanceCriteria: ACCEPTANCE_CRITERIA,
    slides: slideMetrics,
  };
}

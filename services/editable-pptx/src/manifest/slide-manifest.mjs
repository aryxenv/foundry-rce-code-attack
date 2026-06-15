import {
  DEFAULT_EXPORT_MODE,
  NATIVE_EDITABLE_CONTRACT_VERSION,
  NATIVE_OBJECT_KINDS,
  RASTER_FALLBACK_KINDS,
  createRasterFallbackRegion,
  normalizeExportMode,
} from "../contracts/native-editable-contract.mjs";

export const SLIDE_MANIFEST_SCHEMA_VERSION =
  "2026-01-01.native-editable-manifest";

export const MANIFEST_UNITS = Object.freeze({
  CSS_PIXELS: "css-px",
});

export const MANIFEST_ELEMENT_TYPES = Object.freeze({
  TEXT: "text",
  SHAPE: "shape",
  IMAGE: "image",
  VECTOR: "vector",
  FALLBACK: "fallback",
});

export const MANIFEST_FALLBACK_POLICIES = Object.freeze({
  NATIVE: "native",
  ALLOWED_RASTER_REGION: "allowed-raster-region",
  FORBIDDEN_RASTER_REGION: "forbidden-raster-region",
  DEBUG_FULL_SLIDE: "debug-full-slide",
});

const DEFAULT_PAGE_SIZE = Object.freeze({
  width: 1920,
  height: 1080,
});

const TEXT_EDITABILITY = Object.freeze({
  editable: true,
  objectModel: "pptx-text-box",
  locked: false,
  capabilities: {
    text: true,
    position: true,
    size: true,
    font: true,
    fill: false,
    stroke: false,
    geometry: false,
    crop: false,
  },
});

const SHAPE_EDITABILITY = Object.freeze({
  editable: true,
  objectModel: "pptx-shape",
  locked: false,
  capabilities: {
    text: false,
    position: true,
    size: true,
    font: false,
    fill: true,
    stroke: true,
    geometry: true,
    crop: false,
  },
});

const PICTURE_EDITABILITY = Object.freeze({
  editable: true,
  objectModel: "pptx-picture",
  locked: false,
  capabilities: {
    text: false,
    position: true,
    size: true,
    font: false,
    fill: false,
    stroke: false,
    geometry: false,
    crop: true,
  },
});

const FALLBACK_EDITABILITY = Object.freeze({
  editable: false,
  objectModel: "raster-fallback-region",
  locked: true,
  capabilities: {
    text: false,
    position: true,
    size: true,
    font: false,
    fill: false,
    stroke: false,
    geometry: false,
    crop: true,
  },
});

/**
 * @typedef {object} ManifestBounds
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} right
 * @property {number} bottom
 */

/**
 * @typedef {object} TextRun
 * @property {string} text
 * @property {ManifestBounds} bounds
 * @property {ManifestBounds[]} boxes
 * @property {TextStyle} style
 */

/**
 * @typedef {object} TextStyle
 * @property {string} fontFace
 * @property {number} fontSizePx
 * @property {number} fontSizePt
 * @property {string} color
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {string} align
 */

/**
 * @typedef {object} ManifestElement
 * @property {string} id
 * @property {"text"|"shape"|"image"|"vector"|"fallback"} type
 * @property {string} classification
 * @property {string|null} parentId
 * @property {string|null} groupId
 * @property {{ index: number, domOrder: number, cssZIndex: number|null }} zOrder
 * @property {ManifestBounds} bounds
 * @property {object} editability
 * @property {object} fallback
 * @property {Array<{ level: string, code: string, message: string }>} diagnostics
 */

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundPx(value) {
  return Number(finiteNumber(value).toFixed(3));
}

function safeString(value, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeColor(value, fallback = null) {
  if (value === null) {
    return null;
  }

  const normalized = String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .toUpperCase();

  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
}

function normalizeBounds(
  input = {},
  page = DEFAULT_PAGE_SIZE,
  diagnostics = [],
) {
  const x = roundPx(input.x);
  const y = roundPx(input.y);
  const width = Math.max(0, roundPx(input.width));
  const height = Math.max(0, roundPx(input.height));
  const bounds = {
    x,
    y,
    width,
    height,
    right: roundPx(x + width),
    bottom: roundPx(y + height),
  };

  if (width <= 0 || height <= 0) {
    diagnostics.push({
      level: "warning",
      code: "empty-bounds",
      message:
        "Captured element has no visible bounds and will be ignored by synthesis.",
    });
  }

  if (
    x < -1 ||
    y < -1 ||
    bounds.right > page.width + 1 ||
    bounds.bottom > page.height + 1
  ) {
    diagnostics.push({
      level: "info",
      code: "bounds-outside-page",
      message: "Captured element bounds extend outside the export page.",
    });
  }

  return bounds;
}

function boundsFromLegacy(item = {}) {
  return {
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  };
}

function normalizeZOrder(raw = {}, ordinal = 0) {
  const cssZIndex =
    raw.cssZIndex === null || raw.cssZIndex === "auto"
      ? null
      : Number.parseInt(raw.cssZIndex, 10);
  const zIndex = finiteNumber(
    raw.zIndex,
    finiteNumber(raw.zOrder?.index, ordinal),
  );
  const domOrder = finiteNumber(
    raw.domOrder,
    finiteNumber(raw.zOrder?.domOrder, ordinal),
  );

  return {
    index: zIndex,
    domOrder,
    cssZIndex: Number.isFinite(cssZIndex) ? cssZIndex : null,
  };
}

function normalizeTextStyle(raw = {}) {
  const fontSizePx = finiteNumber(raw.fontSizePx, 16);
  const lineHeightPx = finiteNumber(raw.lineHeightPx, fontSizePx * 1.2);
  return {
    fontFace: safeString(raw.fontFace, "Segoe UI"),
    fontSizePx,
    fontSizePt: finiteNumber(raw.fontSizePt, fontSizePx * 0.75),
    color: normalizeColor(raw.color, "0D0D0D") ?? "0D0D0D",
    bold: Boolean(raw.bold),
    italic: Boolean(raw.italic),
    align: safeString(raw.align, "left"),
    lineHeightPx,
    lineHeightPt: finiteNumber(raw.lineHeightPt, lineHeightPx * 0.75),
    letterSpacingPx: finiteNumber(raw.letterSpacingPx, 0),
    textTransform: safeString(raw.textTransform, "none"),
    fontSizeCalibration: raw.fontSizeCalibration
      ? clone(raw.fontSizeCalibration)
      : null,
  };
}

function normalizeLineBox(raw = {}, page, diagnostics, inheritedStyle = null) {
  const bounds = normalizeBounds(raw, page, diagnostics);
  const line = {
    ...bounds,
    baselineY: roundPx(
      finiteNumber(raw.baselineY, bounds.y + bounds.height * 0.82),
    ),
  };

  if (raw.index !== undefined) {
    line.index = finiteNumber(raw.index);
  }

  if (raw.text !== undefined) {
    line.text = safeString(raw.text);
  }

  if (Array.isArray(raw.runs)) {
    const style = inheritedStyle ?? normalizeTextStyle(raw.style ?? {});
    line.runs = raw.runs.map((run) =>
      normalizeTextRun(run, page, style, diagnostics),
    );
  }

  return line;
}

function normalizeTextRun(raw = {}, page, inheritedStyle, diagnostics) {
  const boxes = Array.isArray(raw.boxes)
    ? raw.boxes.map((box) => normalizeLineBox(box, page, diagnostics))
    : [];
  const bounds = normalizeBounds(
    raw.bounds ?? boxes[0] ?? {},
    page,
    diagnostics,
  );

  return {
    text: safeString(raw.text),
    bounds,
    boxes: boxes.length > 0 ? boxes : [bounds],
    style: normalizeTextStyle({ ...inheritedStyle, ...(raw.style ?? {}) }),
  };
}

function textContentFrom(raw = {}) {
  const value =
    raw.text?.content ?? raw.text?.text ?? raw.content ?? raw.label ?? raw.text;

  return safeString(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim())
    .join("\n")
    .trim();
}

function normalizeTextMargins(raw = {}) {
  const uniform = finiteNumber(raw.allPx ?? raw.marginPx ?? raw.paddingPx, 0);
  return {
    leftPx: finiteNumber(raw.leftPx ?? raw.left, uniform),
    topPx: finiteNumber(raw.topPx ?? raw.top, uniform),
    rightPx: finiteNumber(raw.rightPx ?? raw.right, uniform),
    bottomPx: finiteNumber(raw.bottomPx ?? raw.bottom, uniform),
  };
}

function normalizeTextFrame(raw = {}, page, diagnostics) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  return {
    strategy: safeString(raw.strategy),
    bounds: raw.bounds
      ? normalizeBounds(raw.bounds, page, diagnostics)
      : null,
    inkBounds: raw.inkBounds
      ? normalizeBounds(raw.inkBounds, page, diagnostics)
      : null,
    semanticBounds: raw.semanticBounds
      ? normalizeBounds(raw.semanticBounds, page, diagnostics)
      : null,
  };
}

function normalizeWrapValue(value, fallback = "none") {
  const wrap = safeString(value, fallback);
  return wrap === "square" || wrap === "none" ? wrap : fallback;
}

function normalizeFitValue(value, fallback = "no-autofit") {
  const fit = safeString(value, fallback).toLowerCase();
  if (["none", "no-autofit", "shrink", "resize", "shape"].includes(fit)) {
    return fit;
  }
  return fallback;
}

function normalizeTextElement(raw, context) {
  const diagnostics = [];
  const bounds = normalizeBounds(
    raw.bounds ?? boundsFromLegacy(raw),
    context.page,
    diagnostics,
  );
  const style = normalizeTextStyle(
    raw.text?.style ?? raw.textStyle ?? raw.style ?? raw,
  );
  const content = textContentFrom(raw);
  const rawRuns = raw.text?.runs ?? raw.runs;
  const rawLines = raw.text?.lines ?? raw.lineBoxes ?? raw.lines;
  const runs =
    Array.isArray(rawRuns) && rawRuns.length > 0
      ? rawRuns.map((run) =>
          normalizeTextRun(run, context.page, style, diagnostics),
        )
      : [
          normalizeTextRun(
            { text: content, bounds, boxes: rawLines ?? [bounds], style },
            context.page,
            style,
            diagnostics,
          ),
        ];
  const lines =
    Array.isArray(rawLines) && rawLines.length > 0
      ? rawLines.map((line) =>
          normalizeLineBox(line, context.page, diagnostics, style),
        )
      : runs
          .flatMap((run) => run.boxes)
          .map((line) =>
            normalizeLineBox(line, context.page, diagnostics, style),
          );
  const rawParagraph = raw.text?.paragraph ?? raw.paragraph ?? {};
  const wrap = normalizeWrapValue(rawParagraph.wrap ?? raw.wrap, "none");
  const paragraph = {
    align: safeString(rawParagraph.align, style.align),
    verticalAlign: safeString(
      rawParagraph.verticalAlign ?? raw.text?.verticalAlign,
      "top",
    ),
    wrap,
    margins: normalizeTextMargins(
      rawParagraph.margins ?? raw.margins ?? style.margins,
    ),
    fit: normalizeFitValue(
      rawParagraph.fit ?? raw.fit,
      wrap === "square" ? "shrink" : "no-autofit",
    ),
  };

  if (!content) {
    diagnostics.push({
      level: "warning",
      code: "empty-text",
      message: "Text element has no captured text content.",
    });
  }

  diagnostics.unshift(...normalizeDiagnostics(raw.diagnostics));
  const relationships = normalizeRelationships(raw);

  return {
    id: context.id,
    domId: safeString(raw.domId, context.id),
    type: MANIFEST_ELEMENT_TYPES.TEXT,
    classification: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
    nativeKind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
    role: safeString(raw.role, "body"),
    parentId: relationships.parentId,
    groupId: relationships.groupId,
    relationships,
    zOrder: normalizeZOrder(raw, context.ordinal),
    bounds,
    opacity: finiteNumber(raw.opacity, 1),
    source: normalizeSource(raw),
    capture: normalizeCaptureMetadata(raw),
    grouping: raw.grouping ?? raw.text?.grouping ?? null,
    text: {
      content,
      style,
      runs,
      lines,
      paragraph,
      frame: normalizeTextFrame(raw.text?.frame ?? raw.frame, context.page, diagnostics),
      grouping: raw.text?.grouping ?? raw.grouping ?? null,
    },
    shape: null,
    assetRef: null,
    fallback: nativeFallback(),
    editability: clone(TEXT_EDITABILITY),
    diagnostics,
  };
}

function normalizeStroke(raw = {}) {
  return {
    color: normalizeColor(raw.color ?? raw.line),
    widthPx: Math.max(0, finiteNumber(raw.widthPx ?? raw.lineWidthPx)),
    opacity: finiteNumber(raw.opacity, 1),
    dash: safeString(raw.dash, "solid"),
  };
}

function normalizeRadius(raw = {}) {
  const all = finiteNumber(raw.radiusPx ?? raw.borderRadiusPx);
  return {
    topLeftPx: finiteNumber(raw.topLeftPx, all),
    topRightPx: finiteNumber(raw.topRightPx, all),
    bottomRightPx: finiteNumber(raw.bottomRightPx, all),
    bottomLeftPx: finiteNumber(raw.bottomLeftPx, all),
  };
}

function normalizeShapeStyle(raw = {}) {
  const fillColor = normalizeColor(raw.fill?.color ?? raw.fill, null);
  return {
    preset: safeString(raw.preset, "rect"),
    fill: {
      color: fillColor,
      opacity: finiteNumber(
        raw.fill?.opacity ?? raw.fillOpacity,
        fillColor ? 1 : 0,
      ),
    },
    stroke: normalizeStroke(raw.stroke ?? raw),
    radius: normalizeRadius(raw.radius ?? raw),
    opacity: finiteNumber(raw.opacity, 1),
  };
}

function normalizeShapeElement(raw, context) {
  const diagnostics = [];
  const classification = safeString(
    raw.classification ?? raw.kind,
    NATIVE_OBJECT_KINDS.CARD_OR_BOX,
  );
  const bounds = normalizeBounds(
    raw.bounds ?? boundsFromLegacy(raw),
    context.page,
    diagnostics,
  );
  const shape = normalizeShapeStyle(raw.shapeStyle ?? raw.shape ?? raw);
  const maxRadiusPx = Math.max(...Object.values(shape.radius));
  const minDimension = Math.min(bounds.width, bounds.height);
  const looksCircular =
    minDimension > 0 &&
    Math.abs(bounds.width - bounds.height) <= 1 &&
    maxRadiusPx >= minDimension / 2 - 1;
  if (looksCircular) {
    shape.preset = "ellipse";
  } else if (
    shape.preset === "rect" &&
    (classification === NATIVE_OBJECT_KINDS.BUTTON_OR_BADGE || maxRadiusPx > 2)
  ) {
    shape.preset = "roundRect";
  }
  diagnostics.unshift(...normalizeDiagnostics(raw.diagnostics));
  const relationships = normalizeRelationships(raw);

  return {
    id: context.id,
    domId: safeString(raw.domId, context.id),
    type: MANIFEST_ELEMENT_TYPES.SHAPE,
    classification,
    nativeKind: classification,
    role: safeString(raw.role, classification),
    parentId: relationships.parentId,
    groupId: relationships.groupId,
    relationships,
    zOrder: normalizeZOrder(raw, context.ordinal),
    bounds,
    opacity: finiteNumber(raw.opacity, shape.opacity),
    source: normalizeSource(raw),
    capture: normalizeCaptureMetadata(raw),
    text: null,
    shape,
    assetRef: null,
    fallback: nativeFallback(),
    editability: clone(SHAPE_EDITABILITY),
    diagnostics,
  };
}

function normalizeSource(raw = {}) {
  const source = raw.source ?? {};
  return {
    selector: safeString(raw.selector ?? source.selector),
    tagName: safeString(raw.tagName ?? source.tagName).toLowerCase(),
    className: safeString(raw.className ?? source.className),
    dataPptxNative: safeString(
      raw.dataPptxNative ?? source.dataPptxNative ?? raw.kind,
    ),
    dataPptxRole: safeString(raw.dataPptxRole ?? source.dataPptxRole),
    dataPptxGroup: safeString(raw.dataPptxGroup ?? source.dataPptxGroup),
    dataPptxWrap: safeString(raw.dataPptxWrap ?? source.dataPptxWrap),
    dataPptxFit: safeString(raw.dataPptxFit ?? source.dataPptxFit),
    role: safeString(source.role ?? raw.role),
    ariaLabel: safeString(raw.ariaLabel ?? source.ariaLabel ?? raw.label),
    title: safeString(raw.title ?? source.title),
    href: safeString(raw.href ?? source.href),
  };
}

function normalizeDiagnostics(rawDiagnostics = []) {
  if (!Array.isArray(rawDiagnostics)) {
    return [];
  }

  return rawDiagnostics
    .filter(Boolean)
    .map((diagnostic) => ({
      level: safeString(diagnostic.level, "info"),
      code: safeString(diagnostic.code, "capture-diagnostic"),
      message: safeString(diagnostic.message, "Captured DOM diagnostic."),
    }));
}

function normalizeRelationships(raw = {}) {
  const relationships = raw.relationships ?? {};
  return {
    parentId: safeString(raw.parentId ?? relationships.parentId, null),
    groupId: safeString(raw.groupId ?? relationships.groupId, null),
    ancestorIds: Array.isArray(relationships.ancestorIds)
      ? relationships.ancestorIds.map((id) => safeString(id)).filter(Boolean)
      : [],
  };
}

function normalizeCaptureMetadata(raw = {}, fallbackReason = "") {
  const capture = raw.capture ?? {};
  const defaultSuppress = fallbackReason ? false : true;
  const explicitSuppress =
    capture.suppressScreenshotFallback ?? raw.suppressScreenshotFallback;
  return {
    suppressScreenshotFallback:
      explicitSuppress === undefined
        ? defaultSuppress
        : explicitSuppress !== false,
    reason: safeString(capture.reason ?? raw.captureReason),
    confidence: safeString(capture.confidence ?? raw.confidence, "medium"),
    fallbackReason: safeString(
      capture.fallbackReason ?? raw.fallbackReason,
      fallbackReason,
    ),
  };
}

function nativeFallback() {
  return {
    policy: MANIFEST_FALLBACK_POLICIES.NATIVE,
    allowed: true,
    kind: null,
    reason: "Synthesized as a native PowerPoint object.",
    containsVisibleText: false,
    coversFullSlide: false,
  };
}

function fallbackPolicyForRegion(region, mode) {
  if (region.kind === RASTER_FALLBACK_KINDS.DEBUG_FULL_SLIDE_SCREENSHOT) {
    return MANIFEST_FALLBACK_POLICIES.DEBUG_FULL_SLIDE;
  }

  return region.allowed
    ? MANIFEST_FALLBACK_POLICIES.ALLOWED_RASTER_REGION
    : MANIFEST_FALLBACK_POLICIES.FORBIDDEN_RASTER_REGION;
}

function normalizeFallbackRegion(raw = {}, context) {
  const region = createRasterFallbackRegion({
    mode: context.mode,
    kind: safeString(raw.kind, RASTER_FALLBACK_KINDS.PHOTO_OR_COMPLEX_IMAGE),
    ...boundsFromLegacy(raw.bounds ?? raw),
    containsVisibleText: Boolean(raw.containsVisibleText),
    coversFullSlide: Boolean(raw.coversFullSlide),
    reason: safeString(
      raw.reason,
      "Captured as a bounded raster fallback region.",
    ),
  });
  const diagnostics = [];
  const bounds = normalizeBounds(region, context.page, diagnostics);
  diagnostics.unshift(...normalizeDiagnostics(raw.diagnostics));

  if (!region.allowed) {
    diagnostics.push({
      level: "error",
      code: "forbidden-raster-fallback",
      message:
        "Raster fallback is forbidden in native editable mode because it contains visible text or covers the full slide.",
    });
  }

  return {
    id: safeString(
      raw.id,
      `${context.slideId}-fallback-${context.ordinal + 1}`,
    ),
    kind: region.kind,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    bounds,
    containsVisibleText: region.containsVisibleText,
    coversFullSlide: region.coversFullSlide,
    allowed: region.allowed,
    policy: fallbackPolicyForRegion(region, context.mode),
    reason: region.reason,
    diagnostics,
  };
}

function normalizeAssetRef(raw = {}, context, type) {
  const asset = raw.assetRef ?? raw.asset ?? {};
  const assetId = safeString(asset.id, `${context.id}-asset`);
  const data = asset.data ?? raw.data;
  const base64 = asset.base64 ?? raw.base64;
  return {
    id: assetId,
    kind: type,
    href: safeString(asset.href ?? raw.src ?? raw.currentSrc),
    mimeType: safeString(asset.mimeType ?? raw.mimeType),
    altText: safeString(asset.altText ?? raw.alt ?? raw.label),
    intrinsic: {
      width: finiteNumber(asset.intrinsic?.width ?? raw.naturalWidth),
      height: finiteNumber(asset.intrinsic?.height ?? raw.naturalHeight),
    },
    svg: raw.svg ?? asset.svg ?? null,
    ...(data === undefined ? {} : { data }),
    ...(base64 === undefined ? {} : { base64 }),
  };
}

function normalizeImageOptions(raw = {}) {
  const image = raw.image ?? {};
  return {
    fit: safeString(image.fit ?? raw.fit ?? raw.objectFit, "stretch"),
    crop: clone(image.crop ?? raw.crop ?? null),
  };
}

function normalizeVectorOptions(raw = {}) {
  const vector = raw.vector ?? {};
  const paths = raw.paths ?? vector.paths;
  return {
    svgPath: safeString(
      raw.svgPath ?? raw.path ?? vector.svgPath ?? vector.path ?? vector.d,
    ),
    paths: clone(Array.isArray(paths) ? paths : []),
    viewBox: clone(raw.viewBox ?? vector.viewBox ?? null),
  };
}

function normalizeAssetElement(raw, context, type) {
  const diagnostics = [];
  const classification =
    raw.classification ??
    raw.kind ??
    (type === MANIFEST_ELEMENT_TYPES.VECTOR
      ? NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON
      : RASTER_FALLBACK_KINDS.PHOTO_OR_COMPLEX_IMAGE);
  const containsVisibleText = Boolean(raw.containsVisibleText);
  const fallback = normalizeFallbackRegion(
    {
      id: `${context.id}-fallback`,
      kind:
        raw.fallback?.kind ??
        raw.rasterFallbackKind ??
        (type === MANIFEST_ELEMENT_TYPES.VECTOR
          ? RASTER_FALLBACK_KINDS.COMPLEX_SVG_OR_ICON
          : RASTER_FALLBACK_KINDS.PHOTO_OR_COMPLEX_IMAGE),
      bounds: raw.bounds ?? boundsFromLegacy(raw),
      containsVisibleText,
      coversFullSlide: Boolean(raw.coversFullSlide),
      reason:
        raw.fallback?.reason ??
        "Image/vector content is retained as an explicitly bounded region.",
    },
    context,
  );
  const nativeVector =
    type === MANIFEST_ELEMENT_TYPES.VECTOR &&
    classification === NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON &&
    fallback.allowed;
  const hasNativeShapeGeometry =
    nativeVector && Boolean(raw.shapeStyle ?? raw.shape);
  const hasNativeVectorPath =
    nativeVector &&
    Boolean(
      raw.svgPath ??
        raw.path ??
        raw.vector?.svgPath ??
        raw.vector?.path ??
        raw.vector?.d ??
        (Array.isArray(raw.paths ?? raw.vector?.paths) &&
          (raw.paths ?? raw.vector?.paths).length > 0),
    );
  const nativeAsset = Boolean(
    raw.nativeAsset ||
      raw.canRenderNatively ||
      raw.fallback?.kind === null ||
      raw.capture?.suppressScreenshotFallback === true,
  );
  const nativePictureOrVectorAsset =
    nativeAsset &&
    (type === MANIFEST_ELEMENT_TYPES.IMAGE ||
      (type === MANIFEST_ELEMENT_TYPES.VECTOR &&
        classification !== RASTER_FALLBACK_KINDS.COMPLEX_SVG_OR_ICON));
  const useNativeObject =
    hasNativeShapeGeometry || hasNativeVectorPath || nativePictureOrVectorAsset;

  if (fallback.diagnostics.length > 0) {
    diagnostics.push(...fallback.diagnostics);
  }
  diagnostics.unshift(...normalizeDiagnostics(raw.diagnostics));
  const relationships = normalizeRelationships(raw);

  return {
    id: context.id,
    domId: safeString(raw.domId, context.id),
    type,
    classification,
    nativeKind: hasNativeShapeGeometry || hasNativeVectorPath
      ? NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON
      : nativePictureOrVectorAsset &&
          classification !== RASTER_FALLBACK_KINDS.PHOTO_OR_COMPLEX_IMAGE
        ? classification
        : null,
    role: safeString(raw.role, type),
    parentId: relationships.parentId,
    groupId: relationships.groupId,
    relationships,
    zOrder: normalizeZOrder(raw, context.ordinal),
    bounds: normalizeBounds(
      raw.bounds ?? boundsFromLegacy(raw),
      context.page,
      diagnostics,
    ),
    opacity: finiteNumber(raw.opacity, 1),
    source: normalizeSource(raw),
    capture: normalizeCaptureMetadata(
      raw,
      useNativeObject ? "" : fallback.reason,
    ),
    text: null,
    shape: hasNativeShapeGeometry
      ? normalizeShapeStyle(raw.shapeStyle ?? raw.shape ?? raw)
      : null,
    image:
      type === MANIFEST_ELEMENT_TYPES.IMAGE ? normalizeImageOptions(raw) : null,
    vector:
      type === MANIFEST_ELEMENT_TYPES.VECTOR
        ? normalizeVectorOptions(raw)
        : null,
    assetRef: normalizeAssetRef(raw, context, type),
    fallback: useNativeObject ? nativeFallback() : fallback,
    editability: clone(
      hasNativeShapeGeometry || hasNativeVectorPath
        ? SHAPE_EDITABILITY
        : PICTURE_EDITABILITY,
    ),
    diagnostics,
  };
}

function normalizeRawElement(raw, context) {
  const type =
    raw.type ??
    (raw.text || raw.content
      ? MANIFEST_ELEMENT_TYPES.TEXT
      : MANIFEST_ELEMENT_TYPES.SHAPE);
  const id = safeString(
    raw.id,
    `${context.slideId}-${type}-${context.ordinal + 1}`,
  );
  const elementContext = { ...context, id };

  if (type === MANIFEST_ELEMENT_TYPES.TEXT) {
    return normalizeTextElement(raw, elementContext);
  }

  if (
    type === MANIFEST_ELEMENT_TYPES.IMAGE ||
    type === MANIFEST_ELEMENT_TYPES.VECTOR
  ) {
    return normalizeAssetElement(raw, elementContext, type);
  }

  if (type === MANIFEST_ELEMENT_TYPES.FALLBACK) {
    const fallback = normalizeFallbackRegion(raw, elementContext);
    const relationships = normalizeRelationships(raw);
    const hasRasterAsset = Boolean(
      raw.assetRef ?? raw.asset ?? raw.data ?? raw.base64,
    );
    return {
      id,
      domId: safeString(raw.domId, id),
      type: MANIFEST_ELEMENT_TYPES.FALLBACK,
      classification: fallback.kind,
      nativeKind: null,
      role: fallback.kind,
      parentId: relationships.parentId,
      groupId: relationships.groupId,
      relationships,
      zOrder: normalizeZOrder(raw, context.ordinal),
      bounds: fallback.bounds,
      opacity: finiteNumber(raw.opacity, 1),
      source: normalizeSource(raw),
      capture: normalizeCaptureMetadata(raw, fallback.reason),
      text: null,
      shape: null,
      image: hasRasterAsset ? normalizeImageOptions(raw) : null,
      assetRef: hasRasterAsset
        ? normalizeAssetRef(raw, elementContext, MANIFEST_ELEMENT_TYPES.IMAGE)
        : null,
      fallback,
      editability: clone(
        hasRasterAsset && fallback.allowed
          ? PICTURE_EDITABILITY
          : FALLBACK_EDITABILITY,
      ),
      diagnostics: fallback.diagnostics,
    };
  }

  return normalizeShapeElement(raw, elementContext);
}

function legacyTextToRaw(text, ordinal) {
  const bounds = boundsFromLegacy(text);
  return {
    ...text,
    id: text.id,
    type: MANIFEST_ELEMENT_TYPES.TEXT,
    zIndex: ordinal,
    bounds,
    text: {
      content: text.text,
      style: text,
      lines: text.lineBoxes ?? [bounds],
      runs: [
        {
          text: text.text,
          bounds,
          boxes: text.lineBoxes ?? [bounds],
          style: text,
        },
      ],
    },
  };
}

function legacyNativeObjectToRaw(item, ordinal) {
  return {
    ...item,
    id: item.id,
    type: MANIFEST_ELEMENT_TYPES.SHAPE,
    classification: item.kind,
    zIndex: ordinal,
    bounds: boundsFromLegacy(item),
    shapeStyle: {
      fill: item.fill,
      stroke: {
        color: item.line,
        widthPx: item.lineWidthPx,
      },
      radius: {
        radiusPx: item.borderRadiusPx,
      },
    },
  };
}

function rawElementsForSlide(slide = {}) {
  if (Array.isArray(slide.elements) && slide.elements.length > 0) {
    return slide.elements;
  }

  const nativeObjects = (slide.nativeObjects ?? []).map(
    legacyNativeObjectToRaw,
  );
  const texts = (slide.texts ?? []).map((text, index) =>
    legacyTextToRaw(text, nativeObjects.length + index),
  );
  return [...nativeObjects, ...texts];
}

function elementSortKey(element) {
  return [
    finiteNumber(element.zOrder?.cssZIndex, 0),
    finiteNumber(element.zOrder?.index, 0),
    finiteNumber(element.zOrder?.domOrder, 0),
  ];
}

function compareElements(a, b) {
  const aKey = elementSortKey(a);
  const bKey = elementSortKey(b);

  for (let index = 0; index < aKey.length; index += 1) {
    if (aKey[index] !== bKey[index]) {
      return aKey[index] - bKey[index];
    }
  }

  return a.id.localeCompare(b.id);
}

function legacyTextFromElement(element) {
  const style = element.text.style;
  return {
    id: element.id,
    text: element.text.content,
    x: element.bounds.x,
    y: element.bounds.y,
    width: element.bounds.width,
    height: element.bounds.height,
    color: style.color,
    fontFace: style.fontFace,
    fontSizePx: style.fontSizePx,
    fontSizePt: style.fontSizePt,
    bold: style.bold,
    italic: style.italic,
    align: style.align,
    verticalAlign: element.text.paragraph?.verticalAlign,
    lineHeightPx: style.lineHeightPx,
    lineHeightPt: style.lineHeightPt,
    lineBoxes: element.text.lines,
    textLines: element.text.lines,
    textRuns: element.text.runs,
    margins: element.text.paragraph?.margins,
    wrap: element.text.paragraph?.wrap,
    fit: element.text.paragraph?.fit,
  };
}

function legacyNativeObjectFromElement(element) {
  return {
    id: element.id,
    type: element.type,
    kind: element.nativeKind ?? element.classification,
    x: element.bounds.x,
    y: element.bounds.y,
    width: element.bounds.width,
    height: element.bounds.height,
    fill: element.shape?.fill?.color ?? null,
    line: element.shape?.stroke?.color ?? null,
    lineWidthPx: element.shape?.stroke?.widthPx ?? 0,
    borderRadiusPx: Math.max(
      0,
      ...Object.values(element.shape?.radius ?? {}).map((value) =>
        finiteNumber(value),
      ),
    ),
    label: element.source?.ariaLabel ?? element.role ?? "",
    preset: element.shape?.preset,
    hasShapeGeometry: Boolean(element.shape),
    opacity: element.shape?.opacity ?? element.opacity,
    vector: element.vector,
    svgPath: element.vector?.svgPath,
    paths: element.vector?.paths,
    viewBox: element.vector?.viewBox,
    assetRef: element.assetRef,
    crop: element.image?.crop,
    fit: element.image?.fit,
  };
}

function collectSlideDiagnostics(elements, fallbackRegions) {
  return [
    ...elements.flatMap((element) =>
      element.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        elementId: element.id,
      })),
    ),
    ...fallbackRegions.flatMap((region) =>
      region.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        regionId: region.id,
      })),
    ),
  ];
}

function textSuppressionRegionFromElement(element) {
  return {
    id: `${element.id}-text-suppression`,
    kind: "native-visible-text-region",
    bounds: element.bounds,
    x: element.bounds.x,
    y: element.bounds.y,
    width: element.bounds.width,
    height: element.bounds.height,
    containsVisibleText: true,
    suppressScreenshotFallback: true,
    reason:
      element.capture?.reason ||
      "Visible text is emitted natively; suppress any baked screenshot text in this region.",
  };
}

function summarizeSlide({ elements, fallbackRegions, textSuppressionRegions }) {
  const countByType = elements.reduce((counts, element) => {
    counts[element.type] = (counts[element.type] ?? 0) + 1;
    return counts;
  }, {});
  const textElements = elements.filter(
    (element) => element.type === MANIFEST_ELEMENT_TYPES.TEXT,
  );

  return {
    elementCount: elements.length,
    textCount: countByType[MANIFEST_ELEMENT_TYPES.TEXT] ?? 0,
    textLineCount: textElements.reduce(
      (total, element) => total + (element.text?.lines?.length ?? 0),
      0,
    ),
    textRunCount: textElements.reduce(
      (total, element) => total + (element.text?.runs?.length ?? 0),
      0,
    ),
    textSuppressionRegionCount: textSuppressionRegions.length,
    nativeShapeCount: countByType[MANIFEST_ELEMENT_TYPES.SHAPE] ?? 0,
    imageRegionCount: countByType[MANIFEST_ELEMENT_TYPES.IMAGE] ?? 0,
    vectorCount: countByType[MANIFEST_ELEMENT_TYPES.VECTOR] ?? 0,
    fallbackRasterRegions: fallbackRegions.length,
    fallbackRasterAreaPx: Number(
      fallbackRegions
        .reduce(
          (total, region) =>
            total +
            Math.max(0, finiteNumber(region.width)) *
              Math.max(0, finiteNumber(region.height)),
          0,
        )
        .toFixed(3),
    ),
    forbiddenFallbackRasterRegions: fallbackRegions.filter(
      (region) => !region.allowed,
    ).length,
  };
}

export function normalizeCapturedSlideToManifest(
  slide = {},
  { mode = DEFAULT_EXPORT_MODE } = {},
) {
  const normalizedMode = normalizeExportMode(mode);
  const index = finiteNumber(slide.index, 0);
  const slideId = safeString(slide.id, `slide-${index + 1}`);
  const page = {
    width: Math.max(1, roundPx(slide.width ?? DEFAULT_PAGE_SIZE.width)),
    height: Math.max(1, roundPx(slide.height ?? DEFAULT_PAGE_SIZE.height)),
    unit: MANIFEST_UNITS.CSS_PIXELS,
  };
  page.aspectRatio = Number((page.width / page.height).toFixed(6));

  const elements = rawElementsForSlide(slide)
    .map((raw, ordinal) =>
      normalizeRawElement(raw, {
        mode: normalizedMode,
        ordinal,
        page,
        slideId,
      }),
    )
    .filter((element) => element.bounds.width > 0 && element.bounds.height > 0)
    .sort(compareElements)
    .map((element, zIndex) => ({
      ...element,
      zOrder: {
        ...element.zOrder,
        index: zIndex,
      },
    }));
  const elementFallbackRegions = elements
    .filter(
      (element) =>
        element.fallback.policy !== MANIFEST_FALLBACK_POLICIES.NATIVE,
    )
    .map((element) => ({
      ...element.fallback,
      id: `${element.id}-fallback`,
      bounds: element.bounds,
      x: element.bounds.x,
      y: element.bounds.y,
      width: element.bounds.width,
      height: element.bounds.height,
      diagnostics: element.diagnostics,
    }));
  const slideFallbackRegions = (slide.rasterFallbackRegions ?? []).map(
    (region, ordinal) =>
      normalizeFallbackRegion(region, {
        mode: normalizedMode,
        ordinal,
        page,
        slideId,
      }),
  );
  const rasterFallbackRegions = [
    ...slideFallbackRegions,
    ...elementFallbackRegions,
  ];
  const textElements = elements.filter(
    (element) => element.type === MANIFEST_ELEMENT_TYPES.TEXT,
  );
  const textSuppressionRegions = textElements
    .filter((element) => element.capture?.suppressScreenshotFallback !== false)
    .map(textSuppressionRegionFromElement);
  const nativeObjectElements = elements.filter(
    (element) =>
      element.type === MANIFEST_ELEMENT_TYPES.SHAPE ||
      (element.type === MANIFEST_ELEMENT_TYPES.VECTOR && element.nativeKind) ||
      (element.type === MANIFEST_ELEMENT_TYPES.IMAGE && element.nativeKind),
  );
  const diagnostics = collectSlideDiagnostics(elements, rasterFallbackRegions);
  if (normalizedMode === DEFAULT_EXPORT_MODE && slide.backgroundPng) {
    diagnostics.push({
      level: "warning",
      code: "native-background-screenshot-suppressed",
      message:
        "A full-slide screenshot was captured but is suppressed in native editable mode to avoid duplicate baked visible text.",
    });
  }

  return {
    id: slideId,
    index,
    width: page.width,
    height: page.height,
    page,
    coordinateSpace: {
      origin: "top-left",
      unit: MANIFEST_UNITS.CSS_PIXELS,
    },
    elements,
    assets: elements.map((element) => element.assetRef).filter(Boolean),
    texts: textElements.map(legacyTextFromElement),
    nativeObjects: nativeObjectElements.map(legacyNativeObjectFromElement),
    rasterFallbackRegions,
    textSuppressionRegions,
    diagnostics,
    stats: summarizeSlide({
      elements,
      fallbackRegions: rasterFallbackRegions,
      textSuppressionRegions,
    }),
    backgroundPng: slide.backgroundPng,
  };
}

export function normalizeCapturedDeckToManifest(
  capture,
  { mode = DEFAULT_EXPORT_MODE } = {},
) {
  const slides = Array.isArray(capture) ? capture : (capture?.slides ?? []);
  const normalizedMode = normalizeExportMode(capture?.mode ?? mode);
  const normalizedSlides = slides.map((slide) =>
    normalizeCapturedSlideToManifest(slide, { mode: normalizedMode }),
  );
  const diagnostics = normalizedSlides.flatMap((slide) =>
    slide.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      slideId: slide.id,
    })),
  );

  return {
    schemaVersion: SLIDE_MANIFEST_SCHEMA_VERSION,
    contractVersion: NATIVE_EDITABLE_CONTRACT_VERSION,
    mode: normalizedMode,
    units: MANIFEST_UNITS.CSS_PIXELS,
    slideCount: normalizedSlides.length,
    pageDefaults: {
      ...DEFAULT_PAGE_SIZE,
      unit: MANIFEST_UNITS.CSS_PIXELS,
    },
    slides: normalizedSlides,
    diagnostics,
    stats: {
      elementCount: normalizedSlides.reduce(
        (total, slide) => total + slide.stats.elementCount,
        0,
      ),
      textCount: normalizedSlides.reduce(
        (total, slide) => total + slide.stats.textCount,
        0,
      ),
      textLineCount: normalizedSlides.reduce(
        (total, slide) => total + slide.stats.textLineCount,
        0,
      ),
      textRunCount: normalizedSlides.reduce(
        (total, slide) => total + slide.stats.textRunCount,
        0,
      ),
      textSuppressionRegionCount: normalizedSlides.reduce(
        (total, slide) => total + slide.stats.textSuppressionRegionCount,
        0,
      ),
      fallbackRasterRegions: normalizedSlides.reduce(
        (total, slide) => total + slide.stats.fallbackRasterRegions,
        0,
      ),
      fallbackRasterAreaPx: Number(
        normalizedSlides
          .reduce((total, slide) => total + slide.stats.fallbackRasterAreaPx, 0)
          .toFixed(3),
      ),
      forbiddenFallbackRasterRegions: normalizedSlides.reduce(
        (total, slide) => total + slide.stats.forbiddenFallbackRasterRegions,
        0,
      ),
    },
  };
}

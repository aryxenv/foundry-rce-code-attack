import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPORT_MODES,
  NATIVE_OBJECT_KINDS,
  RASTER_FALLBACK_KINDS,
} from "../contracts/native-editable-contract.mjs";
import {
  MANIFEST_ELEMENT_TYPES,
  MANIFEST_FALLBACK_POLICIES,
  SLIDE_MANIFEST_SCHEMA_VERSION,
  normalizeCapturedDeckToManifest,
} from "./slide-manifest.mjs";

const titleStyle = {
  fontFace: "Segoe UI",
  fontSizePx: 40,
  fontSizePt: 30,
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

test("normalizes captured DOM into native slide manifest elements", () => {
  const manifest = normalizeCapturedDeckToManifest({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        index: 0,
        width: 1920,
        height: 1080,
        elements: [
          {
            id: "title",
            type: MANIFEST_ELEMENT_TYPES.TEXT,
            bounds: { x: 120, y: 96, width: 720, height: 56 },
            zIndex: 20,
            text: {
              content: "Quarterly AI plan",
              style: titleStyle,
              runs: [
                {
                  text: "Quarterly",
                  bounds: { x: 120, y: 96, width: 180, height: 48 },
                  boxes: [{ x: 120, y: 96, width: 180, height: 48 }],
                  style: titleStyle,
                },
                {
                  text: "AI plan",
                  bounds: { x: 316, y: 96, width: 156, height: 48 },
                  boxes: [{ x: 316, y: 96, width: 156, height: 48 }],
                  style: { ...titleStyle, color: "2563EB" },
                },
              ],
              lines: [
                { x: 120, y: 96, width: 352, height: 48, baselineY: 135 },
              ],
            },
          },
          {
            id: "card",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.CARD_OR_BOX,
            bounds: { x: 96, y: 80, width: 900, height: 220 },
            zIndex: 10,
            shapeStyle: {
              fill: { color: "FFFFFF", opacity: 1 },
              stroke: { color: "D1D5DB", widthPx: 1 },
              radius: { topLeftPx: 16, topRightPx: 16 },
            },
          },
          {
            id: "hero-photo",
            type: MANIFEST_ELEMENT_TYPES.IMAGE,
            bounds: { x: 1040, y: 120, width: 520, height: 300 },
            zIndex: 30,
            src: "assets/hero.png",
            alt: "Abstract customer photo",
            image: {
              fit: "cover",
              crop: { left: 0.12, top: 0, right: 0.04, bottom: 0 },
            },
            fallback: {
              kind: RASTER_FALLBACK_KINDS.PHOTO_OR_COMPLEX_IMAGE,
              reason: "Photo content is allowed as an isolated image region.",
            },
          },
        ],
      },
    ],
  });

  assert.equal(manifest.schemaVersion, SLIDE_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.slideCount, 1);
  assert.deepEqual(manifest.slides[0].page, {
    width: 1920,
    height: 1080,
    unit: "css-px",
    aspectRatio: 1.777778,
  });

  const [card, title, heroPhoto] = manifest.slides[0].elements;
  assert.equal(card.id, "card");
  assert.equal(card.type, MANIFEST_ELEMENT_TYPES.SHAPE);
  assert.equal(card.shape.fill.color, "FFFFFF");
  assert.equal(card.shape.stroke.widthPx, 1);
  assert.equal(card.editability.objectModel, "pptx-shape");

  assert.equal(title.id, "title");
  assert.equal(title.nativeKind, NATIVE_OBJECT_KINDS.VISIBLE_TEXT);
  assert.equal(title.text.content, "Quarterly AI plan");
  assert.equal(title.text.runs.length, 2);
  assert.equal(title.text.lines.length, 1);
  assert.equal(title.editability.objectModel, "pptx-text-box");
  assert.equal(manifest.slides[0].texts.length, 1);
  assert.equal(manifest.slides[0].texts[0].text, "Quarterly AI plan");

  assert.equal(heroPhoto.type, MANIFEST_ELEMENT_TYPES.IMAGE);
  assert.equal(heroPhoto.image.fit, "cover");
  assert.deepEqual(heroPhoto.image.crop, {
    left: 0.12,
    top: 0,
    right: 0.04,
    bottom: 0,
  });
  assert.equal(heroPhoto.fallback.allowed, true);
  assert.equal(
    heroPhoto.fallback.policy,
    MANIFEST_FALLBACK_POLICIES.ALLOWED_RASTER_REGION,
  );
  assert.equal(manifest.slides[0].rasterFallbackRegions.length, 1);
});

test("diagnoses forbidden raster fallbacks that duplicate visible text", () => {
  const manifest = normalizeCapturedDeckToManifest({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        index: 0,
        width: 1920,
        height: 1080,
        texts: [
          {
            text: "Native text",
            x: 100,
            y: 100,
            width: 400,
            height: 60,
            color: "111827",
            fontFace: "Segoe UI",
            fontSizePx: 32,
            fontSizePt: 24,
          },
        ],
        rasterFallbackRegions: [
          {
            kind: RASTER_FALLBACK_KINDS.DEBUG_FULL_SLIDE_SCREENSHOT,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            containsVisibleText: true,
            coversFullSlide: true,
            reason: "legacy screenshot layer",
          },
        ],
      },
    ],
  });

  const [fallback] = manifest.slides[0].rasterFallbackRegions;
  assert.equal(fallback.allowed, false);
  assert.equal(fallback.policy, MANIFEST_FALLBACK_POLICIES.DEBUG_FULL_SLIDE);
  assert.equal(manifest.stats.forbiddenFallbackRasterRegions, 1);
  assert.equal(manifest.diagnostics[0].code, "forbidden-raster-fallback");
});

test("preserves simple vector path metadata for native freeform synthesis", () => {
  const manifest = normalizeCapturedDeckToManifest({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        index: 0,
        width: 1920,
        height: 1080,
        elements: [
          {
            id: "icon",
            type: MANIFEST_ELEMENT_TYPES.VECTOR,
            classification: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
            bounds: { x: 100, y: 100, width: 48, height: 48 },
            zIndex: 1,
            svgPath: "M0 0 L24 0 L24 24 L0 24 Z",
            viewBox: [0, 0, 24, 24],
            shapeStyle: {
              fill: { color: "2563EB", opacity: 1 },
              stroke: { color: "1D4ED8", widthPx: 1 },
            },
          },
        ],
      },
    ],
  });

  const [icon] = manifest.slides[0].elements;
  assert.equal(icon.nativeKind, NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON);
  assert.equal(icon.editability.objectModel, "pptx-shape");
  assert.equal(icon.vector.svgPath, "M0 0 L24 0 L24 24 L0 24 Z");
  assert.deepEqual(icon.vector.viewBox, [0, 0, 24, 24]);
  assert.equal(manifest.slides[0].nativeObjects[0].svgPath, icon.vector.svgPath);
  assert.equal(manifest.slides[0].rasterFallbackRegions.length, 0);
});

test("preserves circular, rounded, and dashed shape semantics", () => {
  const manifest = normalizeCapturedDeckToManifest({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        index: 0,
        width: 1920,
        height: 1080,
        elements: [
          {
            id: "health-dot",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
            bounds: { x: 100, y: 100, width: 18, height: 18 },
            shapeStyle: {
              preset: "rect",
              fill: { color: "2DBE6C", opacity: 1 },
              stroke: { color: null, widthPx: 0 },
              radius: { radiusPx: 999 },
            },
          },
          {
            id: "rounded-card",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.CARD_OR_BOX,
            bounds: { x: 140, y: 100, width: 320, height: 180 },
            shapeStyle: {
              preset: "rect",
              fill: { color: "FFFFFF", opacity: 1 },
              stroke: { color: "D1D5DB", widthPx: 1, dash: "dashed" },
              radius: { radiusPx: 16 },
            },
          },
        ],
      },
    ],
  });

  const [dot, card] = manifest.slides[0].elements;
  assert.equal(dot.shape.preset, "ellipse");
  assert.equal(card.shape.preset, "roundRect");
  assert.equal(card.shape.stroke.dash, "dashed");
});

test("preserves native DOM capture relationships, assets, and fallback reasons", () => {
  const manifest = normalizeCapturedDeckToManifest({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        id: "dom-capture",
        index: 0,
        width: 1920,
        height: 1080,
        elements: [
          {
            id: "card-card-or-box",
            domId: "card",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.CARD_OR_BOX,
            bounds: { x: 100, y: 120, width: 700, height: 300 },
            domOrder: 4,
            shapeStyle: {
              fill: { color: "FFFFFF", opacity: 1 },
              stroke: { color: "E5E7EB", widthPx: 1 },
              radius: { radiusPx: 18 },
            },
            capture: {
              suppressScreenshotFallback: true,
              reason: "card/panel chrome heuristic",
              confidence: "medium",
            },
          },
          {
            id: "card-text",
            domId: "card-title",
            type: MANIFEST_ELEMENT_TYPES.TEXT,
            parentId: "card",
            groupId: "card",
            relationships: {
              parentId: "card",
              groupId: "card",
              ancestorIds: ["card"],
            },
            bounds: { x: 132, y: 152, width: 360, height: 44 },
            domOrder: 5,
            text: {
              content: "Native grouped title",
              style: titleStyle,
              runs: [
                {
                  text: "Native grouped title",
                  bounds: { x: 132, y: 152, width: 360, height: 44 },
                  boxes: [{ x: 132, y: 152, width: 360, height: 44 }],
                  style: titleStyle,
                },
              ],
              lines: [
                { x: 132, y: 152, width: 360, height: 44, baselineY: 188 },
              ],
              grouping: {
                strategy: "nearest-semantic-text-container",
                runCount: 1,
                lineCount: 1,
                rangeBoxCount: 1,
                textNodeCount: 1,
              },
            },
          },
          {
            id: "meter-progress-bar",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.PROGRESS_BAR,
            parentId: "card",
            bounds: { x: 132, y: 230, width: 420, height: 8 },
            domOrder: 8,
            shapeStyle: {
              fill: { color: "111827", opacity: 1 },
              stroke: { color: null, widthPx: 0 },
              radius: { radiusPx: 4 },
            },
          },
          {
            id: "header-border-bottom",
            type: MANIFEST_ELEMENT_TYPES.SHAPE,
            classification: NATIVE_OBJECT_KINDS.BORDER_OR_LINE,
            bounds: { x: 100, y: 420, width: 700, height: 1 },
            domOrder: 9,
            shapeStyle: {
              fill: { color: "E5E7EB", opacity: 1 },
              stroke: { color: null, widthPx: 0 },
            },
          },
          {
            id: "ms-logo-image",
            type: MANIFEST_ELEMENT_TYPES.IMAGE,
            classification: NATIVE_OBJECT_KINDS.MICROSOFT_OR_ACCOUNT_LOGO,
            bounds: { x: 1640, y: 56, width: 40, height: 40 },
            domOrder: 20,
            src: "assets/microsoft.svg",
            alt: "Microsoft",
            nativeAsset: true,
          },
          {
            id: "demo-canvas",
            type: MANIFEST_ELEMENT_TYPES.FALLBACK,
            classification: RASTER_FALLBACK_KINDS.CANVAS_OR_WEBGL,
            kind: RASTER_FALLBACK_KINDS.CANVAS_OR_WEBGL,
            bounds: { x: 980, y: 180, width: 520, height: 320 },
            domOrder: 24,
            containsVisibleText: false,
            reason: "Canvas chart cannot be decomposed into native shapes.",
            assetRef: {
              id: "demo-canvas-raster",
              kind: MANIFEST_ELEMENT_TYPES.IMAGE,
              mimeType: "image/png",
              altText: "Canvas chart preview",
              data: Buffer.from("bounded canvas fallback"),
            },
            image: {
              fit: "stretch",
            },
            capture: {
              suppressScreenshotFallback: false,
              fallbackReason:
                "Canvas chart cannot be decomposed into native shapes.",
            },
            diagnostics: [
              {
                level: "info",
                code: "bounded-raster-fallback",
                message: "Canvas fallback was bounded to the demo region.",
              },
            ],
          },
        ],
      },
    ],
  });

  const slide = manifest.slides[0];
  assert.equal(slide.elements.length, 6);
  assert.equal(slide.elements[1].parentId, "card");
  assert.equal(slide.elements[1].text.grouping.textNodeCount, 1);
  assert.equal(slide.elements[2].nativeKind, NATIVE_OBJECT_KINDS.PROGRESS_BAR);
  assert.equal(slide.elements[3].nativeKind, NATIVE_OBJECT_KINDS.BORDER_OR_LINE);
  assert.equal(slide.elements[4].fallback.policy, MANIFEST_FALLBACK_POLICIES.NATIVE);
  assert.equal(slide.elements[4].editability.objectModel, "pptx-picture");
  assert.equal(slide.elements[4].assetRef.altText, "Microsoft");
  assert.equal(slide.elements[5].capture.suppressScreenshotFallback, false);
  assert.equal(slide.elements[5].editability.objectModel, "pptx-picture");
  assert.equal(slide.elements[5].assetRef.altText, "Canvas chart preview");
  assert.equal(Buffer.isBuffer(slide.elements[5].assetRef.data), true);
  assert.equal(slide.rasterFallbackRegions.length, 1);
  assert.equal(
    slide.rasterFallbackRegions[0].kind,
    RASTER_FALLBACK_KINDS.CANVAS_OR_WEBGL,
  );
  assert.equal(slide.stats.fallbackRasterAreaPx, 166400);
  assert.equal(manifest.stats.fallbackRasterAreaPx, 166400);
  assert.equal(slide.diagnostics[0].code, "bounded-raster-fallback");
});

test("keeps semantic text as calibrated line groups with screenshot suppression", () => {
  const manifest = normalizeCapturedDeckToManifest({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        index: 0,
        width: 1920,
        height: 1080,
        backgroundPng: Buffer.from("native mode diagnostic screenshot"),
        elements: [
          {
            id: "hero-title-text",
            domId: "hero-title",
            type: MANIFEST_ELEMENT_TYPES.TEXT,
            bounds: { x: 120, y: 96, width: 720, height: 104 },
            text: {
              content: "Modernize with AI\nShip native PPTX",
              style: {
                ...titleStyle,
                fontSizePt: 19.4,
                lineHeightPx: 48,
                lineHeightPt: 24,
              },
              runs: [
                {
                  text: "Modernize with ",
                  bounds: { x: 120, y: 96, width: 304, height: 42 },
                  boxes: [{ x: 120, y: 96, width: 304, height: 42 }],
                  style: { ...titleStyle, fontSizePt: 19.4 },
                },
                {
                  text: "AI",
                  bounds: { x: 424, y: 96, width: 38, height: 42 },
                  boxes: [{ x: 424, y: 96, width: 38, height: 42 }],
                  style: { ...titleStyle, color: "2563EB", fontSizePt: 19.4 },
                },
                {
                  text: "Ship native ",
                  bounds: { x: 120, y: 148, width: 228, height: 42 },
                  boxes: [{ x: 120, y: 148, width: 228, height: 42 }],
                  style: { ...titleStyle, fontSizePt: 19.4 },
                },
                {
                  text: "PPTX",
                  bounds: { x: 348, y: 148, width: 92, height: 42 },
                  boxes: [{ x: 348, y: 148, width: 92, height: 42 }],
                  style: { ...titleStyle, fontSizePt: 19.4 },
                },
              ],
              lines: [
                {
                  x: 120,
                  y: 96,
                  width: 342,
                  height: 42,
                  baselineY: 130,
                  text: "Modernize with AI",
                },
                {
                  x: 120,
                  y: 148,
                  width: 320,
                  height: 42,
                  baselineY: 182,
                  text: "Ship native PPTX",
                },
              ],
              paragraph: {
                wrap: "none",
                margins: { leftPx: 0, topPx: 0, rightPx: 0, bottomPx: 0 },
              },
              grouping: {
                strategy: "nearest-semantic-text-container",
                runCount: 4,
                lineCount: 2,
                rangeBoxCount: 4,
                textNodeCount: 4,
                segmentCount: 4,
              },
            },
          },
        ],
      },
    ],
  });

  const slide = manifest.slides[0];
  const [title] = slide.elements;
  assert.equal(slide.texts.length, 1);
  assert.equal(title.text.content, "Modernize with AI\nShip native PPTX");
  assert.equal(title.text.lines.length, 2);
  assert.equal(title.text.runs.length, 4);
  assert.equal(title.text.paragraph.wrap, "none");
  assert.equal(title.text.paragraph.margins.leftPx, 0);
  assert.equal(title.text.style.color, "111827");
  assert.equal(title.text.runs[1].style.color, "2563EB");
  assert.equal(slide.stats.textLineCount, 2);
  assert.equal(slide.stats.textRunCount, 4);
  assert.equal(slide.textSuppressionRegions.length, 1);
  assert.equal(slide.textSuppressionRegions[0].containsVisibleText, true);
  assert.equal(
    slide.diagnostics.at(-1).code,
    "native-background-screenshot-suppressed",
  );
});

test("normalizes semantic wrap frames and default shrink fit", () => {
  const manifest = normalizeCapturedDeckToManifest({
    mode: EXPORT_MODES.NATIVE_EDITABLE,
    slides: [
      {
        index: 0,
        width: 1920,
        height: 1080,
        elements: [
          {
            id: "body-copy-text",
            type: MANIFEST_ELEMENT_TYPES.TEXT,
            bounds: { x: 120, y: 96, width: 720, height: 120 },
            text: {
              content: "A paragraph that wraps\ninside its layout column.",
              style: bodyStyle,
              lines: [
                {
                  x: 144,
                  y: 104,
                  width: 300,
                  height: 30,
                  text: "A paragraph that wraps",
                },
                {
                  x: 144,
                  y: 138,
                  width: 232,
                  height: 30,
                  text: "inside its layout column.",
                },
              ],
              paragraph: {
                wrap: "square",
                margins: { leftPx: 24, topPx: 8, rightPx: 24, bottomPx: 8 },
              },
              frame: {
                strategy: "semantic-container",
                bounds: { x: 120, y: 96, width: 720, height: 120 },
                inkBounds: { x: 144, y: 104, width: 300, height: 64 },
                semanticBounds: { x: 120, y: 96, width: 720, height: 120 },
              },
            },
          },
        ],
      },
    ],
  });

  const [text] = manifest.slides[0].elements;
  assert.equal(text.bounds.width, 720);
  assert.equal(text.text.paragraph.wrap, "square");
  assert.equal(text.text.paragraph.fit, "shrink");
  assert.equal(text.text.paragraph.margins.leftPx, 24);
  assert.equal(text.text.frame.strategy, "semantic-container");
  assert.equal(text.text.frame.inkBounds.width, 300);
  assert.equal(manifest.slides[0].texts[0].fit, "shrink");
  assert.equal(manifest.stats.textSuppressionRegionCount, 1);
});

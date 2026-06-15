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
} from "../contracts/native-editable-contract.mjs";
import {
  MANIFEST_ELEMENT_TYPES,
  MANIFEST_FALLBACK_POLICIES,
} from "../manifest/slide-manifest.mjs";
import { writePptx } from "./pptx-writer.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const outputDir = path.join(serviceRoot, ".test-output", "ooxml");
const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function readGeneratedParts(slide) {
  await rm(outputDir, { recursive: true, force: true });
  const outputPath = path.join(outputDir, "native-primitives.pptx");
  try {
    await writePptx({
      outputPath,
      mode: EXPORT_MODES.NATIVE_EDITABLE,
      slides: [slide],
    });
    const zip = await JSZip.loadAsync(await readFile(outputPath));
    const slideXml = await zip.file("ppt/slides/slide1.xml").async("string");
    const relsXml = await zip
      .file("ppt/slides/_rels/slide1.xml.rels")
      .async("string");
    const contentTypesXml = await zip.file("[Content_Types].xml").async("string");
    return { zip, slideXml, relsXml, contentTypesXml };
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

function bounds(x, y, width, height) {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function zOrder(index) {
  return { index, domOrder: index, cssZIndex: null };
}

const textStyle = {
  fontFace: "Segoe UI",
  fontSizePx: 24,
  fontSizePt: 18,
  lineHeightPx: 32,
  color: "111827",
  bold: false,
  italic: false,
  align: "center",
};

const primitiveSlide = {
  index: 0,
  width: 1920,
  height: 1080,
  backgroundPng: Buffer.from("debug screenshot must not be used in native mode"),
  elements: [
    {
      id: "card",
      type: MANIFEST_ELEMENT_TYPES.SHAPE,
      classification: NATIVE_OBJECT_KINDS.CARD_OR_BOX,
      nativeKind: NATIVE_OBJECT_KINDS.CARD_OR_BOX,
      zOrder: zOrder(1),
      bounds: bounds(80, 80, 560, 240),
      source: { ariaLabel: "Rounded card" },
      opacity: 1,
      shape: {
        preset: "roundRect",
        fill: { color: "FFFFFF", opacity: 0.75 },
        stroke: { color: "111827", widthPx: 1, opacity: 0.5 },
        radius: { topLeftPx: 16, topRightPx: 16, bottomRightPx: 16, bottomLeftPx: 16 },
      },
    },
    {
      id: "divider",
      type: MANIFEST_ELEMENT_TYPES.SHAPE,
      classification: NATIVE_OBJECT_KINDS.BORDER_OR_LINE,
      nativeKind: NATIVE_OBJECT_KINDS.BORDER_OR_LINE,
      zOrder: zOrder(2),
      bounds: bounds(100, 350, 620, 2),
      source: { ariaLabel: "Divider" },
      opacity: 1,
      shape: {
        fill: { color: "D1D5DB", opacity: 1 },
        stroke: { color: "D1D5DB", widthPx: 2, opacity: 1, dash: "dashed" },
        radius: {},
      },
    },
    {
      id: "progress",
      type: MANIFEST_ELEMENT_TYPES.SHAPE,
      classification: NATIVE_OBJECT_KINDS.PROGRESS_BAR,
      nativeKind: NATIVE_OBJECT_KINDS.PROGRESS_BAR,
      zOrder: zOrder(3),
      bounds: bounds(100, 380, 360, 12),
      source: { ariaLabel: "Progress bar fill" },
      opacity: 1,
      shape: {
        preset: "roundRect",
        fill: { color: "2DBE6C", opacity: 0.9 },
        stroke: { color: "2DBE6C", widthPx: 0, opacity: 0 },
        radius: { topLeftPx: 6, topRightPx: 6, bottomRightPx: 6, bottomLeftPx: 6 },
      },
    },
    {
      id: "health-dot",
      type: MANIFEST_ELEMENT_TYPES.SHAPE,
      classification: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
      nativeKind: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
      zOrder: zOrder(4),
      bounds: bounds(500, 378, 16, 16),
      source: { ariaLabel: "Health dot" },
      opacity: 1,
      shape: {
        preset: "ellipse",
        fill: { color: "2DBE6C", opacity: 1 },
        stroke: { color: "166534", widthPx: 1, opacity: 1 },
        radius: { topLeftPx: 8, topRightPx: 8, bottomRightPx: 8, bottomLeftPx: 8 },
      },
    },
    {
      id: "title",
      type: MANIFEST_ELEMENT_TYPES.TEXT,
      classification: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
      nativeKind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
      zOrder: zOrder(5),
      bounds: bounds(120, 120, 440, 54),
      opacity: 1,
      text: {
        content: "Native editable text",
        style: textStyle,
        runs: [
          { text: "Native ", bounds: bounds(120, 120, 84, 30), boxes: [bounds(120, 120, 84, 30)], style: textStyle },
          { text: "editable text", bounds: bounds(204, 120, 170, 30), boxes: [bounds(204, 120, 170, 30)], style: { ...textStyle, bold: true, color: "2563EB" } },
        ],
        lines: [{ ...bounds(120, 120, 254, 30), baselineY: 144 }],
        paragraph: {
          align: "center",
          verticalAlign: "middle",
          wrap: "none",
          margins: { leftPx: 4, topPx: 2, rightPx: 4, bottomPx: 2 },
        },
      },
    },
    {
      id: "microsoft-logo",
      type: MANIFEST_ELEMENT_TYPES.SHAPE,
      classification: NATIVE_OBJECT_KINDS.MICROSOFT_OR_ACCOUNT_LOGO,
      nativeKind: NATIVE_OBJECT_KINDS.MICROSOFT_OR_ACCOUNT_LOGO,
      zOrder: zOrder(6),
      bounds: bounds(760, 104, 96, 96),
      source: { ariaLabel: "Microsoft logo" },
      opacity: 1,
      shape: null,
    },
    {
      id: "photo",
      type: MANIFEST_ELEMENT_TYPES.IMAGE,
      classification: RASTER_FALLBACK_KINDS.PHOTO_OR_COMPLEX_IMAGE,
      nativeKind: null,
      zOrder: zOrder(7),
      bounds: bounds(900, 120, 180, 120),
      role: "photo",
      source: { ariaLabel: "Inline PNG" },
      opacity: 1,
      image: { fit: "cover", crop: { left: 0.1, top: 0.2, right: 0, bottom: 0 } },
      assetRef: {
        id: "photo-asset",
        kind: MANIFEST_ELEMENT_TYPES.IMAGE,
        href: onePixelPng,
        mimeType: "image/png",
        altText: "Inline PNG",
        intrinsic: { width: 1, height: 1 },
      },
    },
    {
      id: "icon",
      type: MANIFEST_ELEMENT_TYPES.VECTOR,
      classification: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
      nativeKind: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
      zOrder: zOrder(8),
      bounds: bounds(1120, 120, 64, 64),
      source: { ariaLabel: "Simple icon" },
      opacity: 1,
      shape: {
        fill: { color: "2563EB", opacity: 1 },
        stroke: { color: "1D4ED8", widthPx: 1, opacity: 1 },
        radius: {},
      },
      vector: {
        svgPath: "M0 0 L24 0 L24 24 L0 24 Z",
        viewBox: [0, 0, 24, 24],
      },
    },
  ],
};

test("native PPTX writer emits editable primitives without a full-slide raster layer", async () => {
  const { zip, slideXml, relsXml, contentTypesXml } = await readGeneratedParts(
    primitiveSlide,
  );

  assert.match(slideXml, /<a:noAutofit\/>/);
  assert.match(slideXml, /wrap="none"/);
  assert.match(slideXml, /xmlns:p159="http:\/\/schemas\.microsoft\.com\/office\/powerpoint\/2015\/09\/main"/);
  assert.match(slideXml, /mc:Ignorable="p159"/);
  assert.match(slideXml, /<p159:morph option="byObject"\/>/);
  assert.match(
    slideXml,
    /<mc:Fallback><p:transition spd="med" advClick="1"><p:fade\/><\/p:transition><\/mc:Fallback>/,
  );
  assert.match(slideXml, /anchor="ctr"/);
  assert.match(slideXml, /<a:pPr algn="ctr"><a:lnSpc><a:spcPts val="2400"\/><\/a:lnSpc>/);
  assert.match(slideXml, /<a:t(?: xml:space="preserve")?>Native <\/a:t>/);
  assert.match(slideXml, /<a:t>editable text<\/a:t>/);
  assert.match(slideXml, /lIns="\d+"/);

  assert.match(
    slideXml,
    /name="card-or-box: Rounded card"[\s\S]*?<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 6667"\/><\/a:avLst><\/a:prstGeom>/,
  );
  assert.match(slideXml, /<a:alpha val="75000"\/>/);
  assert.match(slideXml, /<p:cxnSp>/);
  assert.match(slideXml, /<a:prstDash val="dash"\/>/);
  assert.match(slideXml, /Progress bar fill/);
  assert.match(
    slideXml,
    /Progress bar fill"[\s\S]*?<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"\/><\/a:avLst><\/a:prstGeom>/,
  );
  assert.match(
    slideXml,
    /name="simple-svg-or-icon: Health dot"[\s\S]*?<a:prstGeom prst="ellipse"><a:avLst\/><\/a:prstGeom>/,
  );

  assert.match(slideXml, /<p:grpSp>/);
  for (const color of ["F25022", "7FBA00", "00A4EF", "FFB900"]) {
    assert.match(slideXml, new RegExp(`<a:srgbClr val="${color}">`));
  }

  assert.match(slideXml, /<p:pic>/);
  assert.match(slideXml, /<a:srcRect l="10000" t="20000" r="0" b="0"\/>/);
  assert.match(relsXml, /Id="rId2" Type="[^\"]+\/image" Target="\.\.\/media\/image-1-1\.png"/);
  assert.ok(zip.file("ppt/media/image-1-1.png"));
  assert.match(contentTypesXml, /Extension="png" ContentType="image\/png"/);

  assert.match(slideXml, /<a:custGeom>/);
  assert.match(slideXml, /<a:path w="24000" h="24000">/);

  assert.doesNotMatch(slideXml, /debug fidelity raster/);
  assert.doesNotMatch(slideXml, /<a:off x="0" y="0"\/><a:ext cx="12192000" cy="6858000"\/>/);
  assert.equal(
    Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/")).length,
    1,
  );
});

test("native PPTX writer emits only allowed bounded raster fallback images", async () => {
  const { zip, slideXml, relsXml, contentTypesXml } = await readGeneratedParts({
    index: 0,
    width: 1920,
    height: 1080,
    elements: [
      {
        id: "editable-label",
        type: MANIFEST_ELEMENT_TYPES.TEXT,
        classification: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        nativeKind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        zOrder: zOrder(1),
        bounds: bounds(120, 120, 320, 40),
        opacity: 1,
        text: {
          content: "Native label",
          style: textStyle,
          runs: [
            {
              text: "Native label",
              bounds: bounds(120, 120, 180, 30),
              boxes: [bounds(120, 120, 180, 30)],
              style: textStyle,
            },
          ],
          lines: [{ ...bounds(120, 120, 180, 30), text: "Native label" }],
        },
      },
      {
        id: "canvas-preview",
        type: MANIFEST_ELEMENT_TYPES.FALLBACK,
        classification: RASTER_FALLBACK_KINDS.CANVAS_OR_WEBGL,
        zOrder: zOrder(2),
        bounds: bounds(520, 160, 360, 220),
        role: "demo preview",
        source: { ariaLabel: "Canvas demo preview" },
        fallback: {
          kind: RASTER_FALLBACK_KINDS.CANVAS_OR_WEBGL,
          allowed: true,
          policy: MANIFEST_FALLBACK_POLICIES.ALLOWED_RASTER_REGION,
          reason: "Canvas demo preview is isolated from editable text.",
        },
        image: { fit: "stretch" },
        assetRef: {
          id: "canvas-preview-raster",
          kind: MANIFEST_ELEMENT_TYPES.IMAGE,
          href: onePixelPng,
          mimeType: "image/png",
          altText: "Canvas demo preview",
          intrinsic: { width: 1, height: 1 },
        },
      },
      {
        id: "forbidden-full-slide",
        type: MANIFEST_ELEMENT_TYPES.FALLBACK,
        classification: RASTER_FALLBACK_KINDS.DEBUG_FULL_SLIDE_SCREENSHOT,
        zOrder: zOrder(3),
        bounds: bounds(0, 0, 1920, 1080),
        fallback: {
          kind: RASTER_FALLBACK_KINDS.DEBUG_FULL_SLIDE_SCREENSHOT,
          allowed: false,
          policy: MANIFEST_FALLBACK_POLICIES.DEBUG_FULL_SLIDE,
          reason: "Full-slide raster fallback is forbidden in native mode.",
        },
        assetRef: {
          id: "forbidden-raster",
          kind: MANIFEST_ELEMENT_TYPES.IMAGE,
          href: onePixelPng,
          mimeType: "image/png",
          altText: "Forbidden full-slide raster",
          intrinsic: { width: 1, height: 1 },
        },
      },
    ],
  });

  assert.match(slideXml, /<a:t>Native label<\/a:t>/);
  assert.match(slideXml, /Canvas demo preview/);
  assert.match(slideXml, /Raster fallback diagnostic:/);
  assert.match(relsXml, /Target="\.\.\/media\/image-1-1\.png"/);
  assert.match(contentTypesXml, /Extension="png" ContentType="image\/png"/);
  assert.equal(
    Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/")).length,
    1,
  );
  assert.doesNotMatch(slideXml, /Forbidden full-slide raster/);
});

test("native PPTX writer keeps measured text lines in stable semantic boxes", async () => {
  const titleLineStyle = {
    ...textStyle,
    align: "left",
    fontSizePx: 40,
    fontSizePt: 19.4,
    lineHeightPx: 48,
    lineHeightPt: 24,
    color: "111827",
    bold: true,
  };
  const bodyStyle = {
    ...textStyle,
    align: "left",
    fontSizePx: 24,
    fontSizePt: 11.8,
    lineHeightPx: 32,
    lineHeightPt: 16,
    color: "374151",
  };
  const { slideXml } = await readGeneratedParts({
    index: 0,
    width: 1920,
    height: 1080,
    backgroundPng: Buffer.from("native mode must not bake screenshot text"),
    elements: [
      {
        id: "hero-title-text",
        type: MANIFEST_ELEMENT_TYPES.TEXT,
        classification: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        nativeKind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        zOrder: zOrder(1),
        bounds: bounds(120, 96, 560, 98),
        opacity: 1,
        text: {
          content: "Modernize with AI\nShip native PPTX",
          style: titleLineStyle,
          paragraph: {
            align: "left",
            verticalAlign: "top",
            wrap: "none",
            margins: { leftPx: 0, topPx: 0, rightPx: 0, bottomPx: 0 },
          },
          runs: [],
          lines: [
            {
              ...bounds(120, 96, 344, 42),
              text: "Modernize with AI",
              baselineY: 130,
              runs: [
                {
                  text: "Modernize with ",
                  bounds: bounds(120, 96, 304, 42),
                  boxes: [bounds(120, 96, 304, 42)],
                  style: titleLineStyle,
                },
                {
                  text: "AI",
                  bounds: bounds(424, 96, 40, 42),
                  boxes: [bounds(424, 96, 40, 42)],
                  style: { ...titleLineStyle, color: "2563EB" },
                },
              ],
            },
            {
              ...bounds(120, 148, 326, 42),
              text: "Ship native PPTX",
              baselineY: 182,
              runs: [
                {
                  text: "Ship native PPTX",
                  bounds: bounds(120, 148, 326, 42),
                  boxes: [bounds(120, 148, 326, 42)],
                  style: titleLineStyle,
                },
              ],
            },
          ],
        },
      },
      {
        id: "body-copy-text",
        type: MANIFEST_ELEMENT_TYPES.TEXT,
        classification: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        nativeKind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        zOrder: zOrder(2),
        bounds: bounds(120, 230, 620, 72),
        opacity: 1,
        text: {
          content: "One coherent body text box,\nnot many raw node fragments.",
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
              ...bounds(120, 230, 360, 30),
              text: "One coherent body text box,",
              baselineY: 254,
              runs: [
                {
                  text: "One coherent body text box,",
                  bounds: bounds(120, 230, 360, 30),
                  boxes: [bounds(120, 230, 360, 30)],
                  style: bodyStyle,
                },
              ],
            },
            {
              ...bounds(120, 264, 420, 30),
              text: "not many raw node fragments.",
              baselineY: 288,
              runs: [
                {
                  text: "not many raw node fragments.",
                  bounds: bounds(120, 264, 420, 30),
                  boxes: [bounds(120, 264, 420, 30)],
                  style: bodyStyle,
                },
              ],
            },
          ],
        },
      },
    ],
  });

  const textBoxCount = (slideXml.match(/<p:cNvSpPr txBox="1"\/>/g) ?? [])
    .length;
  assert.equal(textBoxCount, 2);
  assert.doesNotMatch(slideXml, /native mode must not bake screenshot text/);
  assert.doesNotMatch(slideXml, /debug fidelity raster/);
  assert.match(slideXml, /wrap="none"/);
  assert.match(slideXml, /lIns="0" tIns="0" rIns="0" bIns="0"/);
  assert.match(slideXml, /<a:noAutofit\/>/);
  assert.match(slideXml, /<a:t(?: xml:space="preserve")?>Modernize with <\/a:t>/);
  assert.match(slideXml, /<a:t>AI<\/a:t>/);
  assert.match(slideXml, /<a:t>Ship native PPTX<\/a:t>/);
  assert.match(slideXml, /<a:t>not many raw node fragments\.<\/a:t>/);
  assert.match(slideXml, /<a:srgbClr val="111827">/);
  assert.match(slideXml, /<a:srgbClr val="2563EB">/);
  assert.doesNotMatch(slideXml, /<a:srgbClr val="FF0000">/);
});

test("native PPTX writer uses semantic wrap frames with shrink autofit", async () => {
  const wrappedStyle = {
    ...textStyle,
    align: "left",
    fontSizePx: 24,
    fontSizePt: 12,
    lineHeightPx: 32,
    lineHeightPt: 16,
    color: "374151",
  };
  const { slideXml } = await readGeneratedParts({
    index: 0,
    width: 1920,
    height: 1080,
    elements: [
      {
        id: "wrapped-body",
        type: MANIFEST_ELEMENT_TYPES.TEXT,
        classification: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        nativeKind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        zOrder: zOrder(1),
        bounds: bounds(120, 96, 720, 120),
        opacity: 1,
        text: {
          content: "A paragraph that wraps\ninside its layout column.",
          style: wrappedStyle,
          paragraph: {
            align: "left",
            verticalAlign: "top",
            wrap: "square",
            fit: "shrink",
            margins: { leftPx: 24, topPx: 8, rightPx: 24, bottomPx: 8 },
          },
          lines: [
            {
              ...bounds(144, 104, 300, 30),
              text: "A paragraph that wraps",
              baselineY: 128,
              runs: [
                {
                  text: "A paragraph that wraps",
                  bounds: bounds(144, 104, 300, 30),
                  boxes: [bounds(144, 104, 300, 30)],
                  style: wrappedStyle,
                },
              ],
            },
            {
              ...bounds(144, 138, 232, 30),
              text: "inside its layout column.",
              baselineY: 162,
              runs: [
                {
                  text: "inside its layout column.",
                  bounds: bounds(144, 138, 232, 30),
                  boxes: [bounds(144, 138, 232, 30)],
                  style: wrappedStyle,
                },
              ],
            },
          ],
        },
      },
    ],
  });

  assert.match(slideXml, /wrap="square"/);
  assert.match(
    slideXml,
    /<a:normAutofit fontScale="92%" lnSpcReduction="20%"\/>/,
  );
  assert.match(slideXml, /<a:off x="762000" y="609600"\/><a:ext cx="4572000" cy="762000"\/>/);
  assert.match(slideXml, /lIns="152400" tIns="50800" rIns="152400" bIns="50800"/);
  assert.doesNotMatch(slideXml, /wrap="none"/);
});

test("native PPTX writer calibrates wrapper-captured header typography from measured runs", async () => {
  const wrapperStyle = {
    ...textStyle,
    align: "left",
    fontSizePx: 16,
    fontSizePt: 7.84,
    lineHeightPx: 24,
    lineHeightPt: 12,
    bold: false,
  };
  const titleRunStyle = {
    ...wrapperStyle,
    fontSizePx: 60,
    fontSizePt: 28.8,
    lineHeightPx: 60,
    lineHeightPt: 30,
    bold: true,
  };
  const { slideXml } = await readGeneratedParts({
    index: 0,
    width: 1920,
    height: 1080,
    elements: [
      {
        id: "header-title",
        type: MANIFEST_ELEMENT_TYPES.TEXT,
        classification: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        nativeKind: NATIVE_OBJECT_KINDS.VISIBLE_TEXT,
        zOrder: zOrder(1),
        bounds: bounds(56, 88, 820, 82),
        opacity: 1,
        text: {
          content: "A slide deck, built like a web app.",
          style: wrapperStyle,
          paragraph: {
            align: "left",
            verticalAlign: "top",
            wrap: "none",
            margins: { leftPx: 0, topPx: 0, rightPx: 0, bottomPx: 0 },
          },
          runs: [
            {
              text: "A slide deck, built like a web app.",
              bounds: bounds(56, 90, 820, 80),
              boxes: [bounds(56, 90, 820, 80)],
              style: titleRunStyle,
            },
          ],
          lines: [
            {
              ...bounds(56, 90, 820, 80),
              text: "A slide deck, built like a web app.",
              baselineY: 154,
              runs: [
                {
                  text: "A slide deck, built like a web app.",
                  bounds: bounds(56, 90, 820, 80),
                  boxes: [bounds(56, 90, 820, 80)],
                  style: titleRunStyle,
                },
              ],
            },
          ],
        },
      },
    ],
  });

  assert.match(slideXml, /<a:bodyPr[^>]*lIns="0" tIns="[1-9]\d*" rIns="0" bIns="0"/);
  assert.match(slideXml, /<a:lnSpc><a:spcPts val="3000"\/><\/a:lnSpc>/);
  assert.match(slideXml, /<a:rPr lang="en-US" sz="2880" b="1">/);
  assert.match(slideXml, /<a:endParaRPr lang="en-US" sz="2880"\/>/);
  assert.doesNotMatch(slideXml, /<a:spcPts val="1200"\/>/);
});

test("native PPTX writer keeps fill-only border dividers as exact rectangles", async () => {
  const { slideXml } = await readGeneratedParts({
    index: 0,
    width: 1920,
    height: 1080,
    elements: [
      {
        id: "header-divider",
        type: MANIFEST_ELEMENT_TYPES.SHAPE,
        classification: NATIVE_OBJECT_KINDS.BORDER_OR_LINE,
        nativeKind: NATIVE_OBJECT_KINDS.BORDER_OR_LINE,
        zOrder: zOrder(1),
        bounds: bounds(56, 192, 1808, 1),
        opacity: 1,
        source: { ariaLabel: "bottom border" },
        shape: {
          preset: "rect",
          fill: { color: "E0E0E0", opacity: 1 },
          stroke: { color: null, widthPx: 0, opacity: 0 },
          radius: {},
        },
      },
    ],
  });

  assert.doesNotMatch(slideXml, /<p:cxnSp>/);
  assert.match(slideXml, /name="border-or-line: bottom border"/);
  assert.match(slideXml, /<a:prstGeom prst="rect">/);
  assert.match(slideXml, /<a:solidFill><a:srgbClr val="E0E0E0">/);
});

test("debug fidelity mode is the explicit path for a full-slide raster", async () => {
  await rm(outputDir, { recursive: true, force: true });
  const outputPath = path.join(outputDir, "debug-fidelity.pptx");
  try {
    await writePptx({
      outputPath,
      mode: EXPORT_MODES.DEBUG_FIDELITY,
      slides: [
        {
          index: 0,
          width: 1920,
          height: 1080,
          backgroundPng: Buffer.from("debug image bytes"),
          texts: [
            {
              text: "Debug overlay text",
              x: 100,
              y: 100,
              width: 500,
              height: 80,
              fontSizePt: 24,
              fontSizePx: 32,
              color: "111827",
              fontFace: "Segoe UI",
            },
          ],
        },
      ],
    });
    const zip = await JSZip.loadAsync(await readFile(outputPath));
    const slideXml = await zip.file("ppt/slides/slide1.xml").async("string");
    const relsXml = await zip
      .file("ppt/slides/_rels/slide1.xml.rels")
      .async("string");

    assert.match(slideXml, /debug fidelity raster/);
    assert.match(slideXml, /<a:off x="0" y="0"\/><a:ext cx="12192000" cy="6858000"\/>/);
    assert.match(slideXml, /<a:alpha val="0"\/>/);
    assert.match(relsXml, /Target="\.\.\/media\/image-1-1\.png"/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("unsupported vector paths emit explicit native fallback diagnostics", async () => {
  const { slideXml } = await readGeneratedParts({
    index: 0,
    width: 1920,
    height: 1080,
    elements: [
      {
        id: "arc-icon",
        type: MANIFEST_ELEMENT_TYPES.VECTOR,
        classification: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
        nativeKind: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
        zOrder: zOrder(1),
        bounds: bounds(100, 100, 64, 64),
        source: { ariaLabel: "Unsupported arc icon" },
        opacity: 1,
        vector: {
          svgPath: "M10 10 A20 20 0 0 1 30 30",
          viewBox: [0, 0, 40, 40],
        },
      },
    ],
  });

  assert.match(slideXml, /Vector fallback diagnostic:/);
  assert.doesNotMatch(slideXml, /<a:custGeom>/);
});

test("native PPTX writer uses SVG picture fallback for simple icons without convertible geometry", async () => {
  const helpSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#2563EB" stroke-width="2"/><path d="M9 9 A3 3 0 1 1 12 15" fill="none" stroke="#2563EB" stroke-width="2"/></svg>';
  const { zip, slideXml, relsXml, contentTypesXml } = await readGeneratedParts({
    index: 0,
    width: 1920,
    height: 1080,
    elements: [
      {
        id: "help-icon",
        type: MANIFEST_ELEMENT_TYPES.VECTOR,
        classification: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
        nativeKind: NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
        zOrder: zOrder(1),
        bounds: bounds(1728, 56, 40, 40),
        source: { ariaLabel: "Help icon" },
        opacity: 1,
        vector: {
          svgPath: "M9 9 A3 3 0 1 1 12 15",
          viewBox: [0, 0, 24, 24],
        },
        assetRef: {
          id: "help-icon-svg",
          kind: MANIFEST_ELEMENT_TYPES.VECTOR,
          mimeType: "image/svg+xml",
          altText: "Help icon",
          svg: { markup: helpSvg },
          intrinsic: { width: 24, height: 24 },
        },
      },
    ],
  });

  assert.match(slideXml, /<p:pic>/);
  assert.match(slideXml, /Help icon/);
  assert.doesNotMatch(slideXml, /Vector fallback diagnostic:/);
  assert.doesNotMatch(slideXml, /<a:custGeom>/);
  assert.match(relsXml, /Target="\.\.\/media\/image-1-1\.svg"/);
  assert.match(contentTypesXml, /Extension="svg" ContentType="image\/svg\+xml"/);
  assert.ok(zip.file("ppt/media/image-1-1.svg"));
});

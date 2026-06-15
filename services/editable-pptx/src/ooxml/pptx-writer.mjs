import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_EXPORT_MODE,
  NATIVE_OBJECT_KINDS,
  isDebugFidelityMode,
  normalizeExportMode,
} from "../contracts/native-editable-contract.mjs";
import {
  MANIFEST_ELEMENT_TYPES,
  MANIFEST_FALLBACK_POLICIES,
} from "../manifest/slide-manifest.mjs";
import { ZipWriter } from "./zip-writer.mjs";
import { escapeAttr, escapeXml, xmlDeclaration } from "./xml.mjs";

const SLIDE_CX = 12192000;
const SLIDE_CY = 6858000;
const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const P159_NS = "http://schemas.microsoft.com/office/powerpoint/2015/09/main";
const INVISIBLE_TEXT_ALPHA = 0;
const LINE_WIDTH_EMU_PER_PX = 9525;
const DEFAULT_PAGE_WIDTH = 1920;
const DEFAULT_PAGE_HEIGHT = 1080;
const MICROSOFT_LOGO_COLORS = ["F25022", "7FBA00", "00A4EF", "FFB900"];
const IMAGE_MIME_TYPES = new Map([
  ["image/png", { ext: "png", contentType: "image/png" }],
  ["image/jpeg", { ext: "jpg", contentType: "image/jpeg" }],
  ["image/jpg", { ext: "jpg", contentType: "image/jpeg" }],
  ["image/svg+xml", { ext: "svg", contentType: "image/svg+xml" }],
]);
const PRESET_GEOMETRIES = new Set([
  "rect",
  "roundRect",
  "ellipse",
  "triangle",
  "diamond",
  "parallelogram",
  "trapezoid",
  "hexagon",
  "octagon",
  "line",
]);
const DASH_VALUES = new Set([
  "solid",
  "dot",
  "dash",
  "lgDash",
  "dashDot",
  "lgDashDot",
  "lgDashDotDot",
  "sysDash",
  "sysDot",
  "sysDashDot",
  "sysDashDotDot",
]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeFontFace(fontFace) {
  const first = String(fontFace ?? "Segoe UI")
    .split(",")[0]
    .replaceAll('"', "")
    .replaceAll("'", "")
    .trim();

  return first || "Segoe UI";
}

function safeName(value, fallback) {
  const name = String(value ?? "").trim();
  return name || fallback;
}

function toEmu(value, pageSize, slideSize) {
  const size = Math.max(1, finiteNumber(pageSize, 1));
  return Math.round((finiteNumber(value) / size) * slideSize);
}

function toPositiveEmu(value, pageSize, slideSize) {
  return Math.max(1, toEmu(value, pageSize, slideSize));
}

function pixelToEmuX(value, pageWidth = DEFAULT_PAGE_WIDTH) {
  return Math.max(0, toEmu(value, pageWidth, SLIDE_CX));
}

function pixelToEmuY(value, pageHeight = DEFAULT_PAGE_HEIGHT) {
  return Math.max(0, toEmu(value, pageHeight, SLIDE_CY));
}

function toBoxEmu(item, pageWidth, pageHeight) {
  const fontSizePx = finiteNumber(item.fontSizePx, finiteNumber(item.fontSizePt, 12) / 0.75);
  const lineHeightPx = finiteNumber(item.lineHeightPx, fontSizePx * 1.2);
  const minHeight = Math.max(1, lineHeightPx);
  return {
    x: Math.max(0, toEmu(item.x, pageWidth, SLIDE_CX)),
    y: Math.max(0, toEmu(item.y, pageHeight, SLIDE_CY)),
    cx: toPositiveEmu(item.width, pageWidth, SLIDE_CX),
    cy: toPositiveEmu(Math.max(finiteNumber(item.height, minHeight), minHeight), pageHeight, SLIDE_CY),
  };
}

function toNativeObjectEmu(item, pageWidth, pageHeight) {
  return {
    x: Math.max(0, toEmu(item.x, pageWidth, SLIDE_CX)),
    y: Math.max(0, toEmu(item.y, pageHeight, SLIDE_CY)),
    cx: toPositiveEmu(item.width, pageWidth, SLIDE_CX),
    cy: toPositiveEmu(item.height, pageHeight, SLIDE_CY),
  };
}

function safeColor(color, fallback) {
  const value = String(color ?? "")
    .replace(/^#/, "")
    .toUpperCase();
  return /^[0-9A-F]{6}$/.test(value) ? value : fallback;
}

function opacityValue(value, fallback = 1) {
  return clamp(finiteNumber(value, fallback), 0, 1);
}

function alphaXml(opacity) {
  const alpha = Math.round(opacityValue(opacity) * 100000);
  return alpha < 100000 ? `<a:alpha val="${alpha}"/>` : "";
}

function fillXml(fill = {}) {
  const color = safeColor(fill.color ?? fill, undefined);
  const opacity = opacityValue(fill.opacity, color ? 1 : 0);
  if (!color || opacity <= 0) {
    return "<a:noFill/>";
  }

  return `<a:solidFill><a:srgbClr val="${escapeAttr(color)}">${alphaXml(opacity)}</a:srgbClr></a:solidFill>`;
}

function dashValue(value) {
  const dash = String(value ?? "solid");
  if (dash === "dotted") {
    return "dot";
  }
  if (dash === "dashed") {
    return "dash";
  }
  return DASH_VALUES.has(dash) ? dash : "solid";
}

function linePropertiesXml(stroke = {}) {
  const color = safeColor(stroke.color ?? stroke.line, undefined);
  const widthPx = Math.max(
    0,
    finiteNumber(stroke.widthPx ?? stroke.lineWidthPx ?? stroke.width, 0),
  );
  const opacity = opacityValue(stroke.opacity, color ? 1 : 0);
  const width = Math.max(0, Math.round(widthPx * LINE_WIDTH_EMU_PER_PX));
  if (!color || width === 0 || opacity <= 0) {
    return '<a:ln><a:noFill/></a:ln>';
  }

  return `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="${escapeAttr(color)}">${alphaXml(opacity)}</a:srgbClr></a:solidFill><a:prstDash val="${dashValue(stroke.dash)}"/></a:ln>`;
}

function textAlignToPptx(align) {
  if (align === "center" || align === "centre") {
    return "ctr";
  }

  if (align === "right" || align === "end") {
    return "r";
  }

  if (align === "justify") {
    return "just";
  }

  return "l";
}

function verticalAlignToPptx(align) {
  if (align === "middle" || align === "center" || align === "centre") {
    return "ctr";
  }
  if (align === "bottom") {
    return "b";
  }
  return "t";
}

function relationship(id, type, target) {
  return `<Relationship Id="${escapeAttr(id)}" Type="${REL_NS}/${escapeAttr(type)}" Target="${escapeAttr(target)}"/>`;
}

function contentTypes(slideCount) {
  const slideOverrides = Array.from({ length: slideCount }, (_, index) => {
    const slide = index + 1;
    return `<Override PartName="/ppt/slides/slide${slide}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }).join("");

  return `${xmlDeclaration()}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}</Types>`;
}

function rootRelationships() {
  return `${xmlDeclaration()}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="${PACKAGE_REL_NS}/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function appProperties(slideCount) {
  return `${xmlDeclaration()}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Webslides</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><Company>Microsoft</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`;
}

function coreProperties(title) {
  const now = new Date().toISOString();
  return `${xmlDeclaration()}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>Webslides</dc:creator><cp:lastModifiedBy>Webslides</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function presentation(slideCount) {
  const slideIds = Array.from({ length: slideCount }, (_, index) => {
    const id = 256 + index;
    const rel = `rId${index + 2}`;
    return `<p:sldId id="${id}" r:id="${rel}"/>`;
  }).join("");

  return `${xmlDeclaration()}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`;
}

function presentationRelationships(slideCount) {
  const rels = [
    relationship("rId1", "slideMaster", "slideMasters/slideMaster1.xml"),
  ];
  for (let index = 0; index < slideCount; index += 1) {
    rels.push(
      relationship(`rId${index + 2}`, "slide", `slides/slide${index + 1}.xml`),
    );
  }

  return `${xmlDeclaration()}<Relationships xmlns="${PACKAGE_REL_NS}">${rels.join("")}</Relationships>`;
}

function theme() {
  return `${xmlDeclaration()}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Webslides"><a:themeElements><a:clrScheme name="Webslides"><a:dk1><a:srgbClr val="0D0D0D"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="5C5C5C"/></a:dk2><a:lt2><a:srgbClr val="F5F5F5"/></a:lt2><a:accent1><a:srgbClr val="0D0D0D"/></a:accent1><a:accent2><a:srgbClr val="2DBE6C"/></a:accent2><a:accent3><a:srgbClr val="00ADEF"/></a:accent3><a:accent4><a:srgbClr val="FBBC09"/></a:accent4><a:accent5><a:srgbClr val="F1511B"/></a:accent5><a:accent6><a:srgbClr val="80CC28"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Webslides"><a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Webslides"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function groupShapeStart() {
  return '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
}

function slideMaster() {
  return `${xmlDeclaration()}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${groupShapeStart()}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
}

function slideMasterRelationships() {
  return `${xmlDeclaration()}<Relationships xmlns="${PACKAGE_REL_NS}">${relationship("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")}${relationship("rId2", "theme", "../theme/theme1.xml")}</Relationships>`;
}

function slideLayout() {
  return `${xmlDeclaration()}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${groupShapeStart()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function slideLayoutRelationships() {
  return `${xmlDeclaration()}<Relationships xmlns="${PACKAGE_REL_NS}">${relationship("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")}</Relationships>`;
}

function morphTransitionXml() {
  return `<mc:AlternateContent><mc:Choice Requires="p159"><p:transition spd="med" advClick="1"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="med" advClick="1"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
}

function createIdAllocator(start = 2) {
  let nextId = start;
  return {
    next() {
      const id = nextId;
      nextId += 1;
      return id;
    },
  };
}

function createSlideState(slideNumber) {
  return {
    slideNumber,
    media: [],
    nextRelId: 2,
    addMedia(payload) {
      const relId = `rId${this.nextRelId}`;
      this.nextRelId += 1;
      const name = `image-${this.slideNumber}-${this.media.length + 1}.${payload.ext}`;
      this.media.push({ ...payload, relId, name });
      return relId;
    },
  };
}

function shapeFillFrom(item) {
  const fill = item.fill ?? item.shape?.fill ?? {};
  const itemOpacity = opacityValue(item.opacity, 1);
  return {
    color: fill.color ?? fill,
    opacity: opacityValue(fill.opacity ?? item.fillOpacity, fill.color || fill ? 1 : 0) * itemOpacity,
  };
}

function shapeStrokeFrom(item) {
  const stroke = item.stroke ?? item.line ?? item.shape?.stroke ?? {};
  const itemOpacity = opacityValue(item.opacity, 1);
  return {
    color: stroke.color ?? stroke,
    widthPx: stroke.widthPx ?? stroke.lineWidthPx ?? item.lineWidthPx ?? item.strokeWidthPx,
    opacity: opacityValue(stroke.opacity ?? item.lineOpacity, stroke.color || stroke ? 1 : 0) * itemOpacity,
    dash: stroke.dash ?? item.dash,
  };
}

function hasVisibleShapeStroke(item) {
  const stroke = shapeStrokeFrom(item);
  return Boolean(
    safeColor(stroke.color, undefined) &&
      finiteNumber(stroke.widthPx, 0) > 0 &&
      opacityValue(stroke.opacity, 0) > 0,
  );
}

function radiusFromItem(item = {}) {
  const raw = item.radius ?? item.shape?.radius ?? {};
  const all = finiteNumber(
    raw.radiusPx ?? raw.borderRadiusPx ?? item.radiusPx ?? item.borderRadiusPx,
    0,
  );
  return {
    topLeftPx: finiteNumber(raw.topLeftPx, all),
    topRightPx: finiteNumber(raw.topRightPx, all),
    bottomRightPx: finiteNumber(raw.bottomRightPx, all),
    bottomLeftPx: finiteNumber(raw.bottomLeftPx, all),
  };
}

function maxRadiusFromItem(item = {}) {
  return Math.max(0, ...Object.values(radiusFromItem(item)));
}

function presetForShape(item) {
  const preset =
    item.preset ||
    item.shape?.preset ||
    (maxRadiusFromItem(item) > 0 ? "roundRect" : "rect");
  return PRESET_GEOMETRIES.has(preset) ? preset : "rect";
}

function roundedRectAdjustment(radius, widthPx, heightPx) {
  const maxRadiusPx = Math.max(
    0,
    ...Object.values(radius ?? {}).map((value) => finiteNumber(value)),
  );
  const minDimension = Math.min(finiteNumber(widthPx), finiteNumber(heightPx));
  if (maxRadiusPx <= 0 || minDimension <= 0) {
    return null;
  }

  const ratio = clamp(
    Math.min(maxRadiusPx, minDimension / 2) / minDimension,
    0.01,
    0.5,
  );
  return Math.round(ratio * 100000);
}

function presetGeometryXml(preset, options = {}) {
  if (preset === "roundRect") {
    const adjustment = roundedRectAdjustment(
      options.radius,
      options.widthPx,
      options.heightPx,
    );
    const avList =
      adjustment === null
        ? "<a:avLst/>"
        : `<a:avLst><a:gd name="adj" fmla="val ${adjustment}"/></a:avLst>`;
    return `<a:prstGeom prst="roundRect">${avList}</a:prstGeom>`;
  }

  return `<a:prstGeom prst="${escapeAttr(preset)}"><a:avLst/></a:prstGeom>`;
}

function shapeXmlFromEmu(id, name, rect, options = {}) {
  const preset = options.preset ?? "rect";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeAttr(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${rect.x}" y="${rect.y}"/><a:ext cx="${rect.cx}" cy="${rect.cy}"/></a:xfrm>${presetGeometryXml(preset, options)}${fillXml(options.fill)}${linePropertiesXml(options.stroke)}</p:spPr></p:sp>`;
}

function nativeShapeXml(id, item, pageWidth, pageHeight) {
  const rect = toNativeObjectEmu(item, pageWidth, pageHeight);
  const name = safeName(
    [item.kind, item.label].filter(Boolean).join(": "),
    `Native Shape ${id}`,
  );
  return shapeXmlFromEmu(id, name, rect, {
    preset: presetForShape(item),
    fill: shapeFillFrom(item),
    stroke: shapeStrokeFrom(item),
    radius: radiusFromItem(item),
    widthPx: item.width,
    heightPx: item.height,
  });
}

function isLineCandidate(item) {
  if (item.kind !== NATIVE_OBJECT_KINDS.BORDER_OR_LINE) {
    return false;
  }
  if (item.kind === NATIVE_OBJECT_KINDS.PROGRESS_BAR) {
    return false;
  }

  const width = finiteNumber(item.width);
  const height = finiteNumber(item.height);
  return Math.min(width, height) <= 6 || !safeColor(shapeFillFrom(item).color);
}

function lineConnectorXml(id, item, pageWidth, pageHeight) {
  const rect = toNativeObjectEmu(item, pageWidth, pageHeight);
  const horizontal = finiteNumber(item.width) >= finiteNumber(item.height);
  const thicknessPx = Math.max(1, Math.min(finiteNumber(item.width), finiteNumber(item.height)) || 1);
  const stroke = shapeStrokeFrom(item);
  const fallbackFill = shapeFillFrom(item);
  const lineStroke = {
    ...stroke,
    color: stroke.color ?? fallbackFill.color,
    widthPx: stroke.widthPx || thicknessPx,
    opacity: stroke.opacity || fallbackFill.opacity,
  };
  const off = horizontal
    ? { x: rect.x, y: rect.y + Math.round(rect.cy / 2), cx: rect.cx, cy: 1 }
    : { x: rect.x + Math.round(rect.cx / 2), y: rect.y, cx: 1, cy: rect.cy };
  const name = safeName(item.label, `Native Line ${id}`);

  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${escapeAttr(name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${off.x}" y="${off.y}"/><a:ext cx="${Math.max(1, off.cx)}" cy="${Math.max(1, off.cy)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>${linePropertiesXml(lineStroke)}</p:spPr></p:cxnSp>`;
}

function marginSource(item) {
  return item.margins ?? item.margin ?? item.textMargins ?? item.padding ?? {};
}

function bodyMarginEmu(item, pageWidth, pageHeight) {
  const source = marginSource(item);
  const uniform = finiteNumber(source.allPx ?? source.marginPx ?? item.paddingPx, 0);
  const largestRunFontPx = textParagraphs(item).reduce(
    (largest, paragraph) =>
      Math.max(
        largest,
        ...paragraph.runs.map((run) =>
          finiteNumber(run.style?.fontSizePx, finiteNumber(item.fontSizePx, 0)),
        ),
      ),
    finiteNumber(item.fontSizePx, 0),
  );
  const lowerLargeHeaderTitle =
      largestRunFontPx >= 56 && finiteNumber(item.y, Number.POSITIVE_INFINITY) < 220;
  const calibratedTopInset = lowerLargeHeaderTitle
      ? largestRunFontPx * 0.28
      : uniform === 0 && largestRunFontPx >= 36
        ? largestRunFontPx * 0.28
        : uniform;
  const sourceTopInset = source.topPx ?? source.top;
  return {
      lIns: pixelToEmuX(source.leftPx ?? source.left ?? uniform, pageWidth),
      tIns: pixelToEmuY(
        lowerLargeHeaderTitle ? calibratedTopInset : sourceTopInset ?? calibratedTopInset,
        pageHeight,
      ),
      rIns: pixelToEmuX(source.rightPx ?? source.right ?? uniform, pageWidth),
      bIns: pixelToEmuY(source.bottomPx ?? source.bottom ?? uniform, pageHeight),
  };
}

function runStylesFromLine(line = {}) {
  return Array.isArray(line.runs)
    ? line.runs.map((run) => run.style).filter(Boolean)
    : [];
}

function largestRunMetric(line, key, fallback = 0) {
  return runStylesFromLine(line).reduce(
    (largest, style) => Math.max(largest, finiteNumber(style?.[key], 0)),
    fallback,
  );
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function textRunStyle(run = {}, item = {}) {
  const style = run.style ?? {};
  return {
    fontFace: safeFontFace(style.fontFace ?? item.fontFace),
    fontSizePt: finiteNumber(style.fontSizePt ?? item.fontSizePt, 12),
    color: safeColor(style.color ?? item.color, "0D0D0D"),
    opacity: opacityValue(style.opacity ?? item.opacity, 1),
    bold: Boolean(style.bold ?? item.bold),
    italic: Boolean(style.italic ?? item.italic),
  };
}

function runXml(run, item, { visible = true } = {}) {
  const text = String(run.text ?? "");
  const style = textRunStyle(run, item);
  const fontSize = Math.max(100, Math.round(style.fontSizePt * 100));
  const alpha = visible
    ? alphaXml(style.opacity)
    : `<a:alpha val="${INVISIBLE_TEXT_ALPHA}"/>`;
  const bold = style.bold ? ' b="1"' : "";
  const italic = style.italic ? ' i="1"' : "";
  const preserve = /^\s|\s$|\s{2,}/.test(text) ? ' xml:space="preserve"' : "";

  return `<a:r><a:rPr lang="en-US" sz="${fontSize}"${bold}${italic}><a:solidFill><a:srgbClr val="${escapeAttr(style.color)}">${alpha}</a:srgbClr></a:solidFill><a:latin typeface="${escapeAttr(style.fontFace)}"/><a:ea typeface="${escapeAttr(style.fontFace)}"/><a:cs typeface="${escapeAttr(style.fontFace)}"/></a:rPr><a:t${preserve}>${escapeXml(text)}</a:t></a:r>`;
}

function paragraphPropertiesXml(item, line = {}) {
  const align = textAlignToPptx(item.align ?? item.paragraph?.align);
  const runLineHeightPt = largestRunMetric(line, "lineHeightPt");
  const runLineHeightPx = largestRunMetric(line, "lineHeightPx");
  const runFontSizePt = largestRunMetric(line, "fontSizePt");
  const lineHeightPx = positiveNumber(
    runLineHeightPx,
    positiveNumber(item.lineHeightPx),
  );
  const fallbackFromPx = lineHeightPx * 0.75;
  const fallbackLineHeightPt = positiveNumber(
    item.lineHeightPt,
    positiveNumber(runLineHeightPt, Math.max(runFontSizePt, fallbackFromPx)),
  );
  const resolvedLineHeightPt = positiveNumber(
    line.lineHeightPt,
    positiveNumber(line.heightPt, fallbackLineHeightPt),
  );
  const lineSpacing =
    resolvedLineHeightPt > 0
      ? `<a:lnSpc><a:spcPts val="${Math.round(resolvedLineHeightPt * 100)}"/></a:lnSpc>`
      : "";
  return `<a:pPr algn="${align}">${lineSpacing}<a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>`;
}

function textWrapValue(value) {
  return value === "square" ? "square" : "none";
}

function autofitXml(item, wrap) {
  const fit = String(
    item.fit ?? (wrap === "square" ? "shrink" : "no-autofit"),
  ).toLowerCase();
  if (fit === "shrink" || fit === "norm-autofit" || fit === "text-to-fit-shape") {
    const fontScale = item.fitFontScale ?? item.fontScale ?? "92%";
    const lineSpaceReduction =
      item.fitLineSpaceReduction ?? item.lineSpaceReduction ?? "20%";
    return `<a:normAutofit fontScale="${escapeAttr(fontScale)}" lnSpcReduction="${escapeAttr(lineSpaceReduction)}"/>`;
  }

  if (fit === "resize" || fit === "shape" || fit === "shape-to-fit-text") {
    return "<a:spAutoFit/>";
  }

  return "<a:noAutofit/>";
}

function collectedRunStyles(element) {
  const lineRuns = (element.text?.lines ?? []).flatMap((line) =>
    Array.isArray(line.runs) ? line.runs : [],
  );
  const textRuns = Array.isArray(element.text?.runs) ? element.text.runs : [];
  return [...lineRuns, ...textRuns]
    .map((run) => run.style)
    .filter((style) => Number.isFinite(finiteNumber(style?.fontSizePx, NaN)));
}

function effectiveTextStyle(element) {
  const base = element.text?.style ?? {};
  const runStyles = collectedRunStyles(element);
  if (runStyles.length === 0) {
    return base;
  }

  const largestRunStyle = runStyles.reduce((largest, style) =>
    finiteNumber(style.fontSizePx, 0) > finiteNumber(largest.fontSizePx, 0)
      ? style
      : largest,
  );
  const baseFontSize = finiteNumber(base.fontSizePx, 0);
  const largestFontSize = finiteNumber(largestRunStyle.fontSizePx, 0);
  if (largestFontSize > Math.max(1, baseFontSize) * 1.25) {
    return { ...base, ...largestRunStyle };
  }

  return base;
}

function textParagraphs(item) {
  const textLines = Array.isArray(item.textLines)
    ? item.textLines.filter(
        (line) =>
          String(line.text ?? "").length > 0 ||
          (Array.isArray(line.runs) && line.runs.length > 0),
      )
    : [];
  if (textLines.length > 0) {
    return textLines.map((line) => ({
      line,
      runs:
        Array.isArray(line.runs) && line.runs.length > 0
          ? line.runs
          : [{ text: line.text ?? "", style: item }],
    }));
  }

  const explicitRuns = Array.isArray(item.textRuns) ? item.textRuns : [];
  if (explicitRuns.length > 0) {
    return [{ line: {}, runs: explicitRuns }];
  }

  const text = String(item.text ?? "");
  const lines = text.includes("\n") ? text.split(/\r?\n/) : [text];
  return lines.map((line) => ({
    line: { text: line },
    runs: [{ text: line, style: item }],
  }));
}

function textXml(id, item, pageWidth, pageHeight, { visible = true } = {}) {
  const { x, y, cx, cy } = toBoxEmu(item, pageWidth, pageHeight);
  const margins = bodyMarginEmu(item, pageWidth, pageHeight);
  const verticalAlign = verticalAlignToPptx(item.verticalAlign ?? item.paragraph?.verticalAlign);
  const wrap = textWrapValue(item.wrap);
  const autofit = autofitXml(item, wrap);
  const fontSize = Math.max(100, Math.round(finiteNumber(item.fontSizePt, 12) * 100));
  const paragraphXml = textParagraphs(item)
    .map(({ line, runs }) => {
      const runBody = runs.map((run) => runXml(run, item, { visible })).join("");
      return `<a:p>${paragraphPropertiesXml(item, line)}${runBody}<a:endParaRPr lang="en-US" sz="${fontSize}"/></a:p>`;
    })
    .join("");

  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Editable Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="${escapeAttr(wrap)}" rtlCol="0" anchor="${verticalAlign}" lIns="${margins.lIns}" tIns="${margins.tIns}" rIns="${margins.rIns}" bIns="${margins.bIns}">${autofit}</a:bodyPr><a:lstStyle/>${paragraphXml}</p:txBody></p:sp>`;
}

function pictureXml(id, name, relId, rect, options = {}) {
  const srcRect = cropRectXml(options.crop);
  const noChangeAspect = options.noChangeAspect === false ? "0" : "1";
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${escapeAttr(name)}" descr="${escapeAttr(options.altText ?? "")}"/><p:cNvPicPr><a:picLocks noChangeAspect="${noChangeAspect}"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${escapeAttr(relId)}"/>${srcRect}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${rect.x}" y="${rect.y}"/><a:ext cx="${rect.cx}" cy="${rect.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function cropValue(value) {
  const numeric = finiteNumber(value, 0);
  return Math.round(clamp(numeric <= 1 ? numeric * 100000 : numeric, 0, 100000));
}

function coverCrop(item) {
  const intrinsic = item.intrinsic ?? item.assetRef?.intrinsic ?? {};
  const sourceWidth = finiteNumber(intrinsic.width);
  const sourceHeight = finiteNumber(intrinsic.height);
  const targetWidth = finiteNumber(item.width);
  const targetHeight = finiteNumber(item.height);
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return null;
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;
  if (sourceAspect > targetAspect) {
    const crop = (1 - targetAspect / sourceAspect) / 2;
    return { l: crop, r: crop, t: 0, b: 0 };
  }
  if (sourceAspect < targetAspect) {
    const crop = (1 - sourceAspect / targetAspect) / 2;
    return { l: 0, r: 0, t: crop, b: crop };
  }
  return null;
}

function cropRectXml(crop) {
  if (!crop) {
    return "";
  }

  const left = crop.left ?? crop.l ?? 0;
  const top = crop.top ?? crop.t ?? 0;
  const right = crop.right ?? crop.r ?? 0;
  const bottom = crop.bottom ?? crop.b ?? 0;
  if (!left && !top && !right && !bottom) {
    return "";
  }

  return `<a:srcRect l="${cropValue(left)}" t="${cropValue(top)}" r="${cropValue(right)}" b="${cropValue(bottom)}"/>`;
}

function imagePayloadFromItem(item) {
  const asset = item.assetRef ?? item.asset ?? {};
  const href = item.href ?? item.src ?? asset.href;
  const data = item.data ?? item.base64 ?? asset.data ?? asset.base64;
  const mimeType = item.mimeType ?? asset.mimeType;
  const svgMarkup = item.svg?.markup ?? item.vector?.markup ?? asset.svg?.markup;

  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    const metadata = IMAGE_MIME_TYPES.get(mimeType || "image/png") ?? IMAGE_MIME_TYPES.get("image/png");
    return { buffer: Buffer.from(data), ...metadata };
  }

  if (typeof data === "string" && data.length > 0) {
    const metadata = IMAGE_MIME_TYPES.get(mimeType || "image/png") ?? IMAGE_MIME_TYPES.get("image/png");
    return { buffer: Buffer.from(data, "base64"), ...metadata };
  }

  if (typeof href === "string") {
    const match = href.match(/^data:(image\/(?:png|jpeg|jpg|svg\+xml));base64,(.+)$/i);
    if (match) {
      const metadata = IMAGE_MIME_TYPES.get(match[1].toLowerCase());
      if (metadata) {
        return { buffer: Buffer.from(match[2], "base64"), ...metadata };
      }
    }
  }

  if (typeof svgMarkup === "string" && svgMarkup.length > 0) {
    return {
      buffer: Buffer.from(svgMarkup, "utf8"),
      ...IMAGE_MIME_TYPES.get("image/svg+xml"),
    };
  }

  return null;
}

function imageXml(id, item, pageWidth, pageHeight, state) {
  const payload = imagePayloadFromItem(item);
  if (!payload) {
    return diagnosticShapeXml(
      id,
      item,
      pageWidth,
      pageHeight,
      "Image fallback diagnostic: source image data was unavailable to the OOXML writer.",
    );
  }

  const relId = state.addMedia(payload);
  const rect = toNativeObjectEmu(item, pageWidth, pageHeight);
  const crop = item.crop ?? (item.fit === "cover" ? coverCrop(item) : null);
  return pictureXml(id, safeName(item.label ?? item.altText, `Image ${id}`), relId, rect, {
    crop,
    noChangeAspect: item.fit !== "stretch",
    altText: item.altText,
  });
}

function hasImagePayload(item) {
  return imagePayloadFromItem(item) !== null;
}

function scaledPathPoint(value, origin = 0) {
  return Math.round((finiteNumber(value) - finiteNumber(origin)) * 1000);
}

function viewBoxFromVector(item) {
  const vector = item.vector ?? {};
  const raw = item.viewBox ?? vector.viewBox;
  if (Array.isArray(raw) && raw.length >= 4) {
    return raw.map((value) => finiteNumber(value));
  }
  if (typeof raw === "string") {
    const parts = raw.trim().split(/[\s,]+/).map((value) => finiteNumber(value));
    if (parts.length >= 4) {
      return parts.slice(0, 4);
    }
  }
  if (raw && typeof raw === "object") {
    return [
      finiteNumber(raw.x ?? raw.minX),
      finiteNumber(raw.y ?? raw.minY),
      finiteNumber(raw.width, finiteNumber(item.width, 24)),
      finiteNumber(raw.height, finiteNumber(item.height, 24)),
    ];
  }
  return [0, 0, finiteNumber(item.width, 24), finiteNumber(item.height, 24)];
}

function svgPathFromItem(item) {
  const vector = item.vector ?? {};
  const paths = item.paths ?? vector.paths;
  if (Array.isArray(paths) && paths.length > 0) {
    return paths.map((entry) => (typeof entry === "string" ? entry : entry.d)).filter(Boolean).join(" ");
  }
  return item.svgPath ?? item.path ?? vector.svgPath ?? vector.path ?? vector.d;
}

function pathTokenize(d) {
  return String(d ?? "").match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/g) ?? [];
}

function svgPathToCustomGeometry(d, viewBox) {
  const tokens = pathTokenize(d);
  if (tokens.length === 0) {
    return null;
  }

  const [minX, minY, width, height] = viewBox;
  const pathWidth = Math.max(1, Math.round(finiteNumber(width, 1) * 1000));
  const pathHeight = Math.max(1, Math.round(finiteNumber(height, 1) * 1000));
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let segments = "";

  const isCommand = (token) => /^[a-zA-Z]$/.test(token);
  const hasNumber = () => index < tokens.length && !isCommand(tokens[index]);
  const read = () => finiteNumber(tokens[index++]);
  const pointXml = (px, py) => `<a:pt x="${scaledPathPoint(px, minX)}" y="${scaledPathPoint(py, minY)}"/>`;
  const lineTo = (px, py) => {
    x = px;
    y = py;
    segments += `<a:lnTo>${pointXml(x, y)}</a:lnTo>`;
  };
  const moveTo = (px, py) => {
    x = px;
    y = py;
    segments += `<a:moveTo>${pointXml(x, y)}</a:moveTo>`;
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
    }
    if (!command) {
      return null;
    }

    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M": {
        if (!hasNumber()) return null;
        const firstX = read();
        const firstY = read();
        moveTo(relative ? x + firstX : firstX, relative ? y + firstY : firstY);
        while (hasNumber()) {
          const nextX = read();
          const nextY = read();
          lineTo(relative ? x + nextX : nextX, relative ? y + nextY : nextY);
        }
        break;
      }
      case "L":
        while (hasNumber()) {
          const nextX = read();
          const nextY = read();
          lineTo(relative ? x + nextX : nextX, relative ? y + nextY : nextY);
        }
        break;
      case "H":
        while (hasNumber()) {
          const nextX = read();
          lineTo(relative ? x + nextX : nextX, y);
        }
        break;
      case "V":
        while (hasNumber()) {
          const nextY = read();
          lineTo(x, relative ? y + nextY : nextY);
        }
        break;
      case "C":
        while (hasNumber()) {
          const x1 = read();
          const y1 = read();
          const x2 = read();
          const y2 = read();
          const x3 = read();
          const y3 = read();
          const p1 = { x: relative ? x + x1 : x1, y: relative ? y + y1 : y1 };
          const p2 = { x: relative ? x + x2 : x2, y: relative ? y + y2 : y2 };
          const p3 = { x: relative ? x + x3 : x3, y: relative ? y + y3 : y3 };
          x = p3.x;
          y = p3.y;
          segments += `<a:cubicBezTo>${pointXml(p1.x, p1.y)}${pointXml(p2.x, p2.y)}${pointXml(p3.x, p3.y)}</a:cubicBezTo>`;
        }
        break;
      case "Z":
        segments += "<a:close/>";
        break;
      default:
        return null;
    }
  }

  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="${pathWidth}" b="${pathHeight}"/><a:pathLst><a:path w="${pathWidth}" h="${pathHeight}">${segments}</a:path></a:pathLst></a:custGeom>`;
}

function freeformXml(id, item, pageWidth, pageHeight, customGeometry = null) {
  const geometry =
    customGeometry ??
    svgPathToCustomGeometry(svgPathFromItem(item), viewBoxFromVector(item));
  if (!geometry) {
    return diagnosticShapeXml(
      id,
      item,
      pageWidth,
      pageHeight,
      "Vector fallback diagnostic: only M/L/H/V/C/Z SVG path commands are currently converted to native freeform geometry.",
    );
  }

  const rect = toNativeObjectEmu(item, pageWidth, pageHeight);
  const name = safeName(item.label, `Native Freeform ${id}`);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeAttr(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${rect.x}" y="${rect.y}"/><a:ext cx="${rect.cx}" cy="${rect.cy}"/></a:xfrm>${geometry}${fillXml(shapeFillFrom(item))}${linePropertiesXml(shapeStrokeFrom(item))}</p:spPr></p:sp>`;
}

function isHelpIconItem(item) {
  const path = String(svgPathFromItem(item) ?? "");
  return path.includes("M9.75 9a2.25") && path.includes("M21 12a9 9");
}

function helpIconXml(allocator, item, pageWidth, pageHeight) {
  const textItem = {
    x: item.x + item.width * 0.22,
    y: item.y + item.height * 0.02,
    width: item.width * 0.56,
    height: item.height * 0.72,
    text: "?",
    textLines: [
      {
        text: "?",
        lineHeightPt: Math.max(6, item.height * 0.34),
        runs: [
          {
            text: "?",
            style: {
              fontFace: "Segoe UI",
              fontSizePt: Math.max(6, item.height * 0.34),
              color: "0D0D0D",
              opacity: 1,
              bold: false,
              italic: false,
            },
          },
        ],
      },
    ],
    fontFace: "Segoe UI",
    fontSizePt: Math.max(6, item.height * 0.34),
    color: "0D0D0D",
    align: "center",
    verticalAlign: "middle",
    lineHeightPt: Math.max(6, item.height * 0.34),
    margins: { leftPx: 0, topPx: 0, rightPx: 0, bottomPx: 0 },
    wrap: "none",
    opacity: 1,
  };

  return [
    nativeShapeXml(
      allocator.next(),
      {
        ...item,
        preset: "ellipse",
        fill: { color: null, opacity: 0 },
        stroke: { color: "0D0D0D", widthPx: 1.35, opacity: 1 },
        label: "Help icon outline",
      },
      pageWidth,
      pageHeight,
    ),
    textXml(allocator.next(), textItem, pageWidth, pageHeight),
  ].join("");
}

function diagnosticShapeXml(id, item, pageWidth, pageHeight, reason) {
  const rect = toNativeObjectEmu(item, pageWidth, pageHeight);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeAttr(reason)}" descr="${escapeAttr(reason)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${rect.x}" y="${rect.y}"/><a:ext cx="${rect.cx}" cy="${rect.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}

function microsoftLogoXml(allocator, item, pageWidth, pageHeight) {
  const groupId = allocator.next();
  const rect = toNativeObjectEmu(item, pageWidth, pageHeight);
  const gap = Math.max(1, Math.round(Math.min(rect.cx, rect.cy) * 0.08));
  const cellCx = Math.max(1, Math.round((rect.cx - gap) / 2));
  const cellCy = Math.max(1, Math.round((rect.cy - gap) / 2));
  const cells = [
    { x: 0, y: 0 },
    { x: cellCx + gap, y: 0 },
    { x: 0, y: cellCy + gap },
    { x: cellCx + gap, y: cellCy + gap },
  ];
  const children = cells
    .map((cell, index) =>
      shapeXmlFromEmu(
        allocator.next(),
        `Microsoft logo tile ${index + 1}`,
        { x: cell.x, y: cell.y, cx: cellCx, cy: cellCy },
        { fill: { color: MICROSOFT_LOGO_COLORS[index], opacity: opacityValue(item.opacity, 1) }, stroke: { widthPx: 0 } },
      ),
    )
    .join("");
  const name = safeName(item.label, "Microsoft logo");

  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${groupId}" name="${escapeAttr(name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${rect.x}" y="${rect.y}"/><a:ext cx="${rect.cx}" cy="${rect.cy}"/><a:chOff x="0" y="0"/><a:chExt cx="${rect.cx}" cy="${rect.cy}"/></a:xfrm></p:grpSpPr>${children}</p:grpSp>`;
}

function nativeObjectXml(allocator, item, pageWidth, pageHeight, state) {
  if (item.kind === NATIVE_OBJECT_KINDS.MICROSOFT_OR_ACCOUNT_LOGO) {
    return microsoftLogoXml(allocator, item, pageWidth, pageHeight);
  }

  if (item.kind === NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON) {
    const svgPath = svgPathFromItem(item);
    if (isHelpIconItem(item)) {
      return helpIconXml(allocator, item, pageWidth, pageHeight);
    }

    if (svgPath) {
      const customGeometry = svgPathToCustomGeometry(svgPath, viewBoxFromVector(item));
      if (!customGeometry && hasImagePayload(item)) {
        return imageXml(allocator.next(), item, pageWidth, pageHeight, state);
      }

      return freeformXml(
        allocator.next(),
        item,
        pageWidth,
        pageHeight,
        customGeometry,
      );
    }

    if (hasImagePayload(item)) {
      return imageXml(allocator.next(), item, pageWidth, pageHeight, state);
    }
  }

  if (
    item.type === MANIFEST_ELEMENT_TYPES.VECTOR &&
    !item.hasShapeGeometry &&
    !item.preset
  ) {
    return diagnosticShapeXml(
      allocator.next(),
      item,
      pageWidth,
      pageHeight,
      "Vector fallback diagnostic: vector metadata did not include a convertible path or preset geometry.",
    );
  }

  if (item.type === MANIFEST_ELEMENT_TYPES.IMAGE || item.assetRef?.kind === MANIFEST_ELEMENT_TYPES.IMAGE) {
    return imageXml(allocator.next(), item, pageWidth, pageHeight, state);
  }

  if (isLineCandidate(item) && hasVisibleShapeStroke(item)) {
    return lineConnectorXml(allocator.next(), item, pageWidth, pageHeight);
  }

  return nativeShapeXml(allocator.next(), item, pageWidth, pageHeight);
}

function sortedManifestElements(slide) {
  if (!Array.isArray(slide.elements) || slide.elements.length === 0) {
    return [];
  }

  return [...slide.elements].sort((a, b) => {
    const aOrder = a.zOrder ?? {};
    const bOrder = b.zOrder ?? {};
    return (
      finiteNumber(aOrder.index) - finiteNumber(bOrder.index) ||
      finiteNumber(aOrder.domOrder) - finiteNumber(bOrder.domOrder) ||
      String(a.id ?? "").localeCompare(String(b.id ?? ""))
    );
  });
}

function textItemFromManifestElement(element) {
  const style = effectiveTextStyle(element);
  return {
    id: element.id,
    text: element.text?.content ?? "",
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
    align: element.text?.paragraph?.align ?? style.align,
    verticalAlign: element.text?.paragraph?.verticalAlign,
    lineHeightPx: style.lineHeightPx,
    lineHeightPt: style.lineHeightPt,
    lineBoxes: element.text?.lines ?? [],
    textLines: element.text?.lines ?? [],
    textRuns: element.text?.runs ?? [],
    margins: element.text?.paragraph?.margins ?? style.margins,
    wrap: element.text?.paragraph?.wrap,
    fit: element.text?.paragraph?.fit,
    opacity: element.opacity,
  };
}

function nativeObjectFromManifestElement(element) {
  const radius = element.shape?.radius ?? {};
  return {
    id: element.id,
    type: element.type,
    kind: element.nativeKind ?? element.classification,
    x: element.bounds.x,
    y: element.bounds.y,
    width: element.bounds.width,
    height: element.bounds.height,
    fill: element.shape?.fill,
    stroke: element.shape?.stroke,
    radius: element.shape?.radius,
    line: element.shape?.stroke?.color,
    lineWidthPx: element.shape?.stroke?.widthPx,
    borderRadiusPx: Math.max(0, ...Object.values(radius).map(Number)),
    label: element.source?.ariaLabel ?? element.role ?? "",
    preset: element.shape?.preset,
    hasShapeGeometry: Boolean(element.shape),
    opacity: element.opacity ?? element.shape?.opacity,
    vector: element.vector,
    svgPath: element.vector?.svgPath,
    paths: element.vector?.paths,
    viewBox: element.vector?.viewBox,
    svg: element.assetRef?.svg,
    assetRef: element.assetRef,
    crop: element.image?.crop,
    fit: element.image?.fit,
    altText: element.assetRef?.altText,
    intrinsic: element.assetRef?.intrinsic,
  };
}

function imageItemFromManifestElement(element) {
  return {
    id: element.id,
    type: element.type,
    kind: element.classification,
    x: element.bounds.x,
    y: element.bounds.y,
    width: element.bounds.width,
    height: element.bounds.height,
    label: element.assetRef?.altText ?? element.role,
    altText: element.assetRef?.altText,
    assetRef: element.assetRef,
    crop: element.image?.crop,
    fit: element.image?.fit,
    intrinsic: element.assetRef?.intrinsic,
  };
}

function isRasterFallbackElement(element) {
  return (
    element.type === MANIFEST_ELEMENT_TYPES.FALLBACK ||
    (element.fallback &&
      element.fallback.policy !== MANIFEST_FALLBACK_POLICIES.NATIVE)
  );
}

function shouldRenderFallbackImage(element) {
  return Boolean(
    element.fallback?.allowed &&
      element.assetRef &&
      hasImagePayload(imageItemFromManifestElement(element)),
  );
}

function fallbackDiagnosticXml(allocator, element, pageWidth, pageHeight) {
  return diagnosticShapeXml(
    allocator.next(),
    imageItemFromManifestElement(element),
    pageWidth,
    pageHeight,
    `Raster fallback diagnostic: ${
      element.fallback?.reason ||
      "region was not emitted as an image because no bounded raster payload was available or the region is forbidden."
    }`,
  );
}

function isMicrosoftLogoElement(element) {
  const signal = [
    element.id,
    element.role,
    element.classification,
    element.nativeKind,
    element.source?.ariaLabel,
    element.assetRef?.altText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    element.nativeKind === NATIVE_OBJECT_KINDS.MICROSOFT_OR_ACCOUNT_LOGO &&
    /\b(microsoft|msft)\b/.test(signal)
  );
}

function buildSlideParts(slide, index, { mode }) {
  const pageWidth = slide.width || DEFAULT_PAGE_WIDTH;
  const pageHeight = slide.height || DEFAULT_PAGE_HEIGHT;
  const usesDebugRaster = isDebugFidelityMode(mode) && slide.backgroundPng;
  const shapes = [];
  const allocator = createIdAllocator();
  const state = createSlideState(index);

  if (usesDebugRaster) {
    const relId = state.addMedia({ buffer: slide.backgroundPng, ext: "png", contentType: "image/png" });
    shapes.push(
      pictureXml(
        allocator.next(),
        `Slide ${index} debug fidelity raster`,
        relId,
        { x: 0, y: 0, cx: SLIDE_CX, cy: SLIDE_CY },
      ),
    );
    const textItems = slide.elements?.length
      ? sortedManifestElements(slide)
          .filter((element) => element.type === MANIFEST_ELEMENT_TYPES.TEXT)
          .map(textItemFromManifestElement)
      : (slide.texts ?? []);
    textItems.forEach((item) => {
      shapes.push(
        textXml(allocator.next(), item, pageWidth, pageHeight, {
          visible: false,
        }),
      );
    });
  } else if (slide.elements?.length) {
    for (const element of sortedManifestElements(slide)) {
      if (element.type === MANIFEST_ELEMENT_TYPES.TEXT) {
        shapes.push(
          textXml(
            allocator.next(),
            textItemFromManifestElement(element),
            pageWidth,
            pageHeight,
          ),
        );
      } else if (element.type === MANIFEST_ELEMENT_TYPES.IMAGE) {
        if (isMicrosoftLogoElement(element)) {
          shapes.push(
            nativeObjectXml(
              allocator,
              nativeObjectFromManifestElement(element),
              pageWidth,
              pageHeight,
              state,
            ),
          );
        } else {
          shapes.push(
            imageXml(
              allocator.next(),
              imageItemFromManifestElement(element),
              pageWidth,
              pageHeight,
              state,
            ),
          );
        }
      } else if (isRasterFallbackElement(element)) {
        if (shouldRenderFallbackImage(element)) {
          shapes.push(
            imageXml(
              allocator.next(),
              imageItemFromManifestElement(element),
              pageWidth,
              pageHeight,
              state,
            ),
          );
        } else {
          shapes.push(
            fallbackDiagnosticXml(allocator, element, pageWidth, pageHeight),
          );
        }
      } else if (
        element.type === MANIFEST_ELEMENT_TYPES.SHAPE ||
        element.type === MANIFEST_ELEMENT_TYPES.VECTOR
      ) {
        shapes.push(
          nativeObjectXml(
            allocator,
            nativeObjectFromManifestElement(element),
            pageWidth,
            pageHeight,
            state,
          ),
        );
      }
    }
  } else {
    for (const item of slide.nativeObjects ?? []) {
      shapes.push(nativeObjectXml(allocator, item, pageWidth, pageHeight, state));
    }

    (slide.images ?? []).forEach((item) => {
      shapes.push(imageXml(allocator.next(), item, pageWidth, pageHeight, state));
    });

    (slide.texts ?? []).forEach((item) => {
      shapes.push(
        textXml(allocator.next(), item, pageWidth, pageHeight, {
          visible: !usesDebugRaster,
        }),
      );
    });
  }

  const xml = `${xmlDeclaration()}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:mc="${MC_NS}" xmlns:p159="${P159_NS}" mc:Ignorable="p159"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${groupShapeStart()}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${morphTransitionXml()}</p:sld>`;
  return { xml, media: state.media };
}

function slideRelationships(media = []) {
  const relationships = [
    relationship("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
    ...media.map((item) => relationship(item.relId, "image", `../media/${item.name}`)),
  ];

  return `${xmlDeclaration()}<Relationships xmlns="${PACKAGE_REL_NS}">${relationships.join("")}</Relationships>`;
}

export async function writePptx({
  outputPath,
  slides,
  title = "Webslides",
  mode = DEFAULT_EXPORT_MODE,
}) {
  if (!slides.length) {
    throw new Error("Cannot write an editable PPTX without slides.");
  }

  const exportMode = normalizeExportMode(mode);
  const zip = new ZipWriter();
  zip.addFile("[Content_Types].xml", contentTypes(slides.length));
  zip.addFile("_rels/.rels", rootRelationships());
  zip.addFile("docProps/app.xml", appProperties(slides.length));
  zip.addFile("docProps/core.xml", coreProperties(title));
  zip.addFile("ppt/presentation.xml", presentation(slides.length));
  zip.addFile(
    "ppt/_rels/presentation.xml.rels",
    presentationRelationships(slides.length),
  );
  zip.addFile("ppt/theme/theme1.xml", theme());
  zip.addFile("ppt/slideMasters/slideMaster1.xml", slideMaster());
  zip.addFile(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    slideMasterRelationships(),
  );
  zip.addFile("ppt/slideLayouts/slideLayout1.xml", slideLayout());
  zip.addFile(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    slideLayoutRelationships(),
  );

  slides.forEach((slide, index) => {
    const slideNumber = index + 1;
    const parts = buildSlideParts(slide, slideNumber, { mode: exportMode });
    zip.addFile(`ppt/slides/slide${slideNumber}.xml`, parts.xml);
    zip.addFile(
      `ppt/slides/_rels/slide${slideNumber}.xml.rels`,
      slideRelationships(parts.media),
    );
    for (const media of parts.media) {
      zip.addFile(`ppt/media/${media.name}`, media.buffer, { compress: false });
    }
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, zip.toBuffer());
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  EXPORT_MODES,
  NATIVE_OBJECT_KINDS,
  RASTER_FALLBACK_KINDS,
  normalizeExportMode,
} from "../contracts/native-editable-contract.mjs";

const SLIDE_CX = 12192000;
const SLIDE_CY = 6858000;
const REQUIRED_PACKAGE_PARTS = Object.freeze([
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/app.xml",
  "docProps/core.xml",
  "ppt/presentation.xml",
  "ppt/_rels/presentation.xml.rels",
  "ppt/theme/theme1.xml",
  "ppt/slideMasters/slideMaster1.xml",
  "ppt/slideMasters/_rels/slideMaster1.xml.rels",
  "ppt/slideLayouts/slideLayout1.xml",
  "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
]);
const REQUIRED_REPORT_METRICS = Object.freeze([
  "editabilityScore",
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
  "forbiddenDuplicateBakedVisibleText",
]);

function countMatches(value, pattern) {
  return (String(value ?? "").match(pattern) ?? []).length;
}

function parseAttributes(value) {
  const attributes = {};
  for (const match of String(value ?? "").matchAll(
    /([A-Za-z_:][\w:.-]*)="([^"]*)"/g,
  )) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function relationshipBasePath(relsPath) {
  if (relsPath === "_rels/.rels") {
    return "";
  }

  return relsPath.replace(/\/_rels\/[^/]+\.rels$/, "");
}

function resolveRelationshipTarget(relsPath, target) {
  if (!target) {
    return "";
  }

  if (target.startsWith("/")) {
    return path.posix.normalize(target.slice(1));
  }

  return path.posix
    .normalize(path.posix.join(relationshipBasePath(relsPath), target))
    .replace(/^\.\//, "");
}

function relationshipTargets(relsPath, xml) {
  return Array.from(String(xml ?? "").matchAll(/<Relationship\b([^>]*)\/?>/g))
    .map((match) => parseAttributes(match[1]))
    .filter((attributes) => attributes.TargetMode !== "External")
    .map((attributes) => ({
      id: attributes.Id,
      type: attributes.Type,
      target: attributes.Target,
      resolvedTarget: resolveRelationshipTarget(relsPath, attributes.Target),
    }));
}

function fullSlideRasterPictureCount(slideXml) {
  const picturePattern = /<p:pic>[\s\S]*?<\/p:pic>/g;
  return Array.from(String(slideXml ?? "").matchAll(picturePattern)).filter(
    (match) =>
      new RegExp(
        `<a:off x="0" y="0"\\/>\\s*<a:ext cx="${SLIDE_CX}" cy="${SLIDE_CY}"\\/>`,
      ).test(match[0]),
  ).length;
}

async function readZipText(zip, name) {
  const file = zip.file(name);
  return file ? file.async("string") : "";
}

function missingRequiredParts(files) {
  return REQUIRED_PACKAGE_PARTS.filter((part) => !files.has(part));
}

export async function inspectPptxPackage(input) {
  const buffer = Buffer.isBuffer(input) ? input : await readFile(input);
  const errors = [];
  const zip = await JSZip.loadAsync(buffer);
  const files = new Set(
    Object.keys(zip.files)
      .filter((name) => !zip.files[name].dir)
      .map((name) => name.replaceAll("\\", "/")),
  );
  for (const part of missingRequiredParts(files)) {
    errors.push(`Missing required package part: ${part}`);
  }

  const slideParts = [...files]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const left = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const right = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return left - right;
    });
  if (slideParts.length === 0) {
    errors.push("Package does not contain any slide parts.");
  }

  const contentTypesXml = await readZipText(zip, "[Content_Types].xml");
  for (const slidePart of slideParts) {
    if (!contentTypesXml.includes(`PartName="/${slidePart}"`)) {
      errors.push(`Missing content type override for ${slidePart}`);
    }
  }

  const relsParts = [...files].filter((name) => name.endsWith(".rels"));
  const relationships = [];
  for (const relsPart of relsParts) {
    const relsXml = await readZipText(zip, relsPart);
    for (const relationship of relationshipTargets(relsPart, relsXml)) {
      relationships.push({ relsPart, ...relationship });
      if (!relationship.resolvedTarget || !files.has(relationship.resolvedTarget)) {
        errors.push(
          `Relationship ${relationship.id ?? "(unknown)"} in ${relsPart} targets missing part ${relationship.target}`,
        );
      }
    }
  }

  const slides = [];
  for (const slidePart of slideParts) {
    const slideXml = await readZipText(zip, slidePart);
    const slideNumber = Number(slidePart.match(/slide(\d+)\.xml/)?.[1] ?? 0);
    const relsPart = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
    if (!files.has(relsPart)) {
      errors.push(`Missing slide relationships for ${slidePart}`);
    }

    slides.push({
      part: slidePart,
      relationshipsPart: relsPart,
      textBoxes: countMatches(slideXml, /<p:cNvSpPr txBox="1"\/>/g),
      wrapSquareTextBoxes: countMatches(slideXml, /<a:bodyPr\b[^>]*wrap="square"/g),
      wrapNoneTextBoxes: countMatches(slideXml, /<a:bodyPr\b[^>]*wrap="none"/g),
      normalAutofitTextBoxes: countMatches(slideXml, /<a:normAutofit\b/g),
      noAutofitTextBoxes: countMatches(slideXml, /<a:noAutofit\/>/g),
      shapeAutofitTextBoxes: countMatches(slideXml, /<a:spAutoFit\/>/g),
      shapes: countMatches(slideXml, /<p:sp>/g),
      connectors: countMatches(slideXml, /<p:cxnSp>/g),
      pictures: countMatches(slideXml, /<p:pic>/g),
      groupShapes: countMatches(slideXml, /<p:grpSp>/g),
      fullSlideRasterPictures: fullSlideRasterPictureCount(slideXml),
      hiddenTextRuns: countMatches(slideXml, /<a:alpha val="0"\/>/g),
    });
  }

  const totals = slides.reduce(
    (summary, slide) => {
      summary.textBoxes += slide.textBoxes;
      summary.wrapSquareTextBoxes += slide.wrapSquareTextBoxes;
      summary.wrapNoneTextBoxes += slide.wrapNoneTextBoxes;
      summary.normalAutofitTextBoxes += slide.normalAutofitTextBoxes;
      summary.noAutofitTextBoxes += slide.noAutofitTextBoxes;
      summary.shapeAutofitTextBoxes += slide.shapeAutofitTextBoxes;
      summary.shapes += slide.shapes;
      summary.connectors += slide.connectors;
      summary.pictures += slide.pictures;
      summary.groupShapes += slide.groupShapes;
      summary.fullSlideRasterPictures += slide.fullSlideRasterPictures;
      summary.hiddenTextRuns += slide.hiddenTextRuns;
      return summary;
    },
    {
      textBoxes: 0,
      wrapSquareTextBoxes: 0,
      wrapNoneTextBoxes: 0,
      normalAutofitTextBoxes: 0,
      noAutofitTextBoxes: 0,
      shapeAutofitTextBoxes: 0,
      shapes: 0,
      connectors: 0,
      pictures: 0,
      groupShapes: 0,
      fullSlideRasterPictures: 0,
      hiddenTextRuns: 0,
    },
  );

  const mediaParts = [...files].filter((name) => name.startsWith("ppt/media/"));
  return {
    valid: errors.length === 0,
    errors,
    parts: {
      count: files.size,
      required: REQUIRED_PACKAGE_PARTS,
      slides: slideParts,
      media: mediaParts,
    },
    relationships,
    slides,
    totals,
  };
}

function requireMetric(report, key, failures) {
  if (!(key in report)) {
    failures.push(`Report is missing metric: ${key}`);
  }
}

function nativeCount(report, kind) {
  return Number(report.nativeObjectCounts?.[kind] ?? 0);
}

function assertNativeObjectCoverage(report, expectedNativeKinds, failures) {
  for (const kind of expectedNativeKinds) {
    if (nativeCount(report, kind) < 1) {
      failures.push(`Report did not include native coverage for ${kind}.`);
    }
  }
}

function assertPptxPrimitiveCoverage(inspection, expectedNativeKinds, failures) {
  const expectedShapeKinds = [
    NATIVE_OBJECT_KINDS.CARD_OR_BOX,
    NATIVE_OBJECT_KINDS.BUTTON_OR_BADGE,
    NATIVE_OBJECT_KINDS.PROGRESS_BAR,
    NATIVE_OBJECT_KINDS.SIMPLE_SVG_OR_ICON,
  ];
  if (
    expectedNativeKinds.some((kind) => expectedShapeKinds.includes(kind)) &&
    inspection.totals.shapes < 1
  ) {
    failures.push("PPTX package does not contain native shape primitives.");
  }

  if (
    expectedNativeKinds.includes(NATIVE_OBJECT_KINDS.BORDER_OR_LINE) &&
    inspection.totals.connectors < 1
  ) {
    failures.push("PPTX package does not contain native line primitives.");
  }

  if (
    expectedNativeKinds.includes(NATIVE_OBJECT_KINDS.MICROSOFT_OR_ACCOUNT_LOGO) &&
    inspection.totals.groupShapes + inspection.totals.pictures < 1
  ) {
    failures.push("PPTX package does not contain native logo primitives.");
  }
}

export function assertNativeQualityGates({
  mode,
  report,
  packageInspection,
  expectedNativeKinds = [],
  expectedSemanticTextBoxes,
  minAverageLinesPerTextBox,
  minEditabilityScore = 0,
} = {}) {
  const normalizedMode = normalizeExportMode(mode ?? report?.mode);
  const failures = [];

  if (!report) {
    failures.push("Missing export quality report.");
  }
  if (!packageInspection) {
    failures.push("Missing PPTX package inspection.");
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  if (!packageInspection.valid) {
    failures.push(...packageInspection.errors);
  }

  for (const key of REQUIRED_REPORT_METRICS) {
    requireMetric(report, key, failures);
  }

  if (typeof report.editabilityScore !== "number") {
    failures.push("Report editabilityScore must be numeric.");
  } else if (report.editabilityScore < minEditabilityScore) {
    failures.push(
      `Report editabilityScore ${report.editabilityScore} is below ${minEditabilityScore}.`,
    );
  }

  if (normalizedMode === EXPORT_MODES.NATIVE_EDITABLE) {
    if (packageInspection.totals.fullSlideRasterPictures > 0) {
      failures.push(
        "Native-editable PPTX includes a full-slide raster fallback picture.",
      );
    }
    if (
      Number(
        report.fallbackRasterRegionCounts?.[
          RASTER_FALLBACK_KINDS.DEBUG_FULL_SLIDE_SCREENSHOT
        ] ?? 0,
      ) > 0
    ) {
      failures.push(
        "Native-editable report includes a debug full-slide screenshot fallback.",
      );
    }
    if (report.forbiddenFallbackRasterRegions > 0) {
      failures.push("Native-editable report includes forbidden fallbacks.");
    }
    if (report.duplicateBakedVisibleTextRegions > 0) {
      failures.push("Native-editable report includes duplicate baked text.");
    }
    if (report.forbiddenDuplicateBakedVisibleText) {
      failures.push("Native-editable report flagged duplicate baked text.");
    }
  }

  if (expectedSemanticTextBoxes !== undefined) {
    if (report.editableTextBoxes !== expectedSemanticTextBoxes) {
      failures.push(
        `Expected ${expectedSemanticTextBoxes} coherent text boxes in report, got ${report.editableTextBoxes}.`,
      );
    }
    if (packageInspection.totals.textBoxes !== expectedSemanticTextBoxes) {
      failures.push(
        `Expected ${expectedSemanticTextBoxes} PPTX text boxes, got ${packageInspection.totals.textBoxes}.`,
      );
    }
  }

  if (minAverageLinesPerTextBox !== undefined && report.editableTextBoxes > 0) {
    const averageLinesPerTextBox =
      report.editableTextLines / report.editableTextBoxes;
    if (averageLinesPerTextBox < minAverageLinesPerTextBox) {
      failures.push(
        `Average lines per text box ${averageLinesPerTextBox.toFixed(3)} is below ${minAverageLinesPerTextBox}.`,
      );
    }
  }

  if (!Array.isArray(report.fallbackRasterReasons)) {
    failures.push("Report fallbackRasterReasons must be an array.");
  } else {
    if (report.fallbackRasterReasons.length !== report.fallbackRasterRegions) {
      failures.push(
        "Report fallbackRasterReasons length must match fallbackRasterRegions.",
      );
    }
    for (const reason of report.fallbackRasterReasons) {
      if (!reason.reason || !reason.kind || !reason.bounds) {
        failures.push("Every fallback reason must include kind, bounds, and reason.");
        break;
      }
    }
  }

  if (report.fallbackRasterRegions > 0 && report.fallbackRasterAreaPx <= 0) {
    failures.push("Report fallbackRasterAreaPx must be positive when fallbacks exist.");
  }

  assertNativeObjectCoverage(report, expectedNativeKinds, failures);
  assertPptxPrimitiveCoverage(packageInspection, expectedNativeKinds, failures);

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  return {
    valid: true,
    mode: normalizedMode,
    editabilityScore: report.editabilityScore,
    fallbackRasterAreaPx: report.fallbackRasterAreaPx,
    packageTotals: packageInspection.totals,
  };
}

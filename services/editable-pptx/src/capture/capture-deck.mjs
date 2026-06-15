import { chromium } from "playwright";
import { EXPORT_TIMEOUTS } from "../contracts/export-contracts.mjs";
import {
  DEFAULT_EXPORT_MODE,
  createDebugFullSlideFallback,
  isDebugFidelityMode,
  isAllowedRasterFallback,
  normalizeExportMode,
} from "../contracts/native-editable-contract.mjs";
import { normalizeCapturedDeckToManifest } from "../manifest/slide-manifest.mjs";

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const fallbackPorts = ["5173", "5174", "5175", "5176"];

function toExportUrl(input) {
  const url = new URL(input);
  url.searchParams.set("export", "pdf");
  url.searchParams.delete("slide");
  return url.toString();
}

function buildExportUrls(input) {
  const initialUrl = new URL(input);
  const urls = [toExportUrl(initialUrl)];

  if (localHosts.has(initialUrl.hostname)) {
    for (const port of fallbackPorts) {
      if (port === initialUrl.port) {
        continue;
      }

      const fallbackUrl = new URL(initialUrl);
      fallbackUrl.port = port;
      urls.push(toExportUrl(fallbackUrl));
    }
  }

  return [...new Set(urls)];
}

async function launchBrowser() {
  const configuredChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
  if (configuredChannel) {
    return chromium.launch({ channel: configuredChannel });
  }

  try {
    return await chromium.launch({ channel: "msedge" });
  } catch {
    return chromium.launch();
  }
}

async function openExportDeckPage(browser, urls) {
  const errors = [];

  for (const url of urls) {
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: { width: 1920, height: 1080 },
    });

    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (response && !response.ok()) {
        throw new Error(`Server responded ${response.status()}`);
      }

      if (url !== urls[0]) {
        console.warn(
          `Primary editable PPTX export URL was unavailable; using ${url}`,
        );
      }

      return page;
    } catch (error) {
      errors.push(
        `${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await page.close().catch(() => undefined);
    }
  }

  throw new Error(
    [
      "Could not reach the local web deck for editable PPTX export.",
      "Start the client with `npm run dev` and retry.",
      ...errors,
    ].join("\n"),
  );
}

async function waitForReady(page) {
  await page.waitForFunction(
    () =>
      window.__webslidesExportReady === true ||
      document.documentElement.dataset.webslidesExportReady === "true",
    null,
    { timeout: EXPORT_TIMEOUTS.cliMilliseconds.browserReady },
  );

  await page.evaluate(async () => {
    if ("fonts" in document) {
      await document.fonts.ready;
    }

    await Promise.all(
      Array.from(document.images).map((image) => {
        if (image.complete) {
          return undefined;
        }

        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }),
    );
  });
}

async function waitForExportSettled(page) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector(".pdf-export-deck") ?? document.body;
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0.01 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const pendingSelectors = [
        '[aria-busy="true"]',
        '[data-loading="true"]',
        '[data-state="loading"]',
      ];
      return !pendingSelectors.some((selector) =>
        Array.from(root.querySelectorAll(selector)).some(isVisible),
      );
    },
    null,
    { timeout: EXPORT_TIMEOUTS.cliMilliseconds.exportSettled },
  );

  await page.waitForTimeout(250);
}

function captureScript() {
  function parseRgb(value, fallback = "0D0D0D") {
    const match = String(value ?? "").match(
      /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i,
    );
    if (!match) {
      return fallback;
    }

    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (alpha < 0.05) {
      return null;
    }

    return [match[1], match[2], match[3]]
      .map((part) =>
        Math.max(0, Math.min(255, Math.round(Number(part))))
          .toString(16)
          .padStart(2, "0")
          .toUpperCase(),
      )
      .join("");
  }

  function applyTextTransform(text, style) {
    if (style.textTransform === "uppercase") {
      return text.toUpperCase();
    }
    if (style.textTransform === "lowercase") {
      return text.toLowerCase();
    }
    if (style.textTransform === "capitalize") {
      return text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
    }

    return text;
  }

  function renderedText(text, style, options = {}) {
    const preserveLineBreaks = options.preserveLineBreaks === true;
    const trim = options.trim !== false;
    const normalized = preserveLineBreaks
      ? String(text ?? "")
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .split("\n")
          .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim())
          .join("\n")
      : String(text ?? "").replace(/[^\S\r\n]+/g, " ");
    const prepared = trim ? normalized.trim() : normalized;

    return applyTextTransform(prepared, style);
  }

  function isElementVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0.01 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function relativeRect(rect, pageRect) {
    return {
      x: rect.left - pageRect.left,
      y: rect.top - pageRect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function unionBounds(boxes) {
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  function buildDomOrder(pageElement) {
    const order = new Map([[pageElement, 0]]);
    Array.from(pageElement.querySelectorAll("*")).forEach((element, index) => {
      order.set(element, index + 1);
    });
    return order;
  }

  function cssZIndex(element) {
    const value = window.getComputedStyle(element).zIndex;
    if (value === "auto") {
      return null;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sanitizeId(value) {
    return String(value ?? "")
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function elementBaseId(element, domOrder) {
    const explicit = sanitizeId(
      element.getAttribute("data-pptx-id") || element.id || "",
    );
    if (explicit) {
      return explicit;
    }

    return `dom-${domOrder.get(element) ?? 0}`;
  }

  function elementManifestId(element, type, domOrder, suffix = type) {
    return `${elementBaseId(element, domOrder)}-${sanitizeId(suffix) || type}`;
  }

  function visibleParentId(element, pageElement, domOrder) {
    let current = element.parentElement;
    while (current && current !== pageElement) {
      if (isElementVisible(current)) {
        return elementBaseId(current, domOrder);
      }
      current = current.parentElement;
    }

    return null;
  }

  function groupIdForElement(element, pageElement, domOrder) {
    const group = element.closest(
      "[data-pptx-group],[data-pptx-native],section,article,[role='group'],[role='region']",
    );
    if (!group || group === pageElement) {
      return null;
    }

    return elementBaseId(group, domOrder);
  }

  function ancestorIdsForElement(element, pageElement, domOrder) {
    const ids = [];
    let current = element.parentElement;
    while (current && current !== pageElement) {
      if (isElementVisible(current)) {
        ids.push(elementBaseId(current, domOrder));
      }
      current = current.parentElement;
    }

    return ids;
  }

  function sourceForElement(element) {
    const className =
      typeof element.className === "string"
        ? element.className
        : (element.getAttribute("class") ?? "");
    return {
      selector: element.id
        ? `#${element.id}`
        : (element.getAttribute("data-pptx-id") ?? ""),
      tagName: element.tagName.toLowerCase(),
      className,
      dataPptxNative: element.getAttribute("data-pptx-native") ?? "",
      dataPptxRole: element.getAttribute("data-pptx-role") ?? "",
      dataPptxGroup: element.getAttribute("data-pptx-group") ?? "",
      dataPptxWrap: element.getAttribute("data-pptx-wrap") ?? "",
      dataPptxFit: element.getAttribute("data-pptx-fit") ?? "",
      role: element.getAttribute("role") ?? "",
      ariaLabel: element.getAttribute("aria-label") ?? "",
      title: element.getAttribute("title") ?? "",
      href: element.getAttribute("href") ?? "",
    };
  }

  function baseElementData(type, element, pageRect, domOrder, options = {}) {
    const order = domOrder.get(element) ?? 0;
    const zIndex = cssZIndex(element);
    const source = sourceForElement(element);
    const pageElement = options.pageElement ?? element.closest(".pdf-export-page");
    const parentId = pageElement
      ? visibleParentId(element, pageElement, domOrder)
      : null;
    const groupId = pageElement
      ? groupIdForElement(element, pageElement, domOrder)
      : null;
    const captureReason =
      options.reason ??
      (source.dataPptxNative
        ? `data-pptx-native=${source.dataPptxNative}`
        : "computed DOM style heuristic");

    return {
      id:
        options.id ??
        elementManifestId(element, type, domOrder, options.suffix ?? type),
      domId: elementBaseId(element, domOrder),
      type,
      bounds: relativeRect(element.getBoundingClientRect(), pageRect),
      zIndex: zIndex ?? order,
      cssZIndex: zIndex,
      domOrder: order,
      parentId,
      groupId,
      relationships: {
        parentId,
        groupId,
        ancestorIds: pageElement
          ? ancestorIdsForElement(element, pageElement, domOrder)
          : [],
      },
      opacity: Number(window.getComputedStyle(element).opacity) || 1,
      source,
      capture: {
        suppressScreenshotFallback: options.suppressScreenshotFallback !== false,
        reason: captureReason,
        confidence: options.confidence ?? "medium",
        fallbackReason: options.fallbackReason ?? "",
      },
      ...source,
    };
  }

  function textPointScale(pageRect) {
    const widthScale = 960 / Math.max(1, pageRect?.width ?? 1920);
    const heightScale = 540 / Math.max(1, pageRect?.height ?? 1080);
    return (widthScale + heightScale) / 2;
  }

  function calibratedFontSizePt(fontSizePx, style, pageRect) {
    const family = String(style.fontFamily ?? "").toLowerCase();
    const weight = Number.parseInt(style.fontWeight, 10);
    let correction = 0.99;

    if (family.includes("segoe ui") || family.includes("aptos")) {
      correction = 0.98;
    }
    if (Number.isFinite(weight) && weight >= 600) {
      correction -= 0.01;
    }
    if (fontSizePx >= 36) {
      correction -= 0.01;
    }

    return fontSizePx * textPointScale(pageRect) * correction;
  }

  function textStyle(style, pageRect) {
    const fontSizePx = Number.parseFloat(style.fontSize);
    const lineHeightPx = Number.parseFloat(style.lineHeight);
    const normalizedLineHeightPx = Number.isFinite(lineHeightPx)
      ? lineHeightPx
      : fontSizePx * 1.2;
    const pointScale = textPointScale(pageRect);

    return {
      color: parseRgb(style.color),
      fontFace: style.fontFamily || "Segoe UI",
      fontSizePx,
      fontSizePt: calibratedFontSizePt(fontSizePx, style, pageRect),
      bold:
        style.fontWeight === "bold" ||
        Number.parseInt(style.fontWeight, 10) >= 600,
      italic: style.fontStyle === "italic" || style.fontStyle === "oblique",
      align: style.textAlign,
      lineHeightPx: normalizedLineHeightPx,
      lineHeightPt: normalizedLineHeightPx * pointScale,
      letterSpacingPx: Number.parseFloat(style.letterSpacing) || 0,
      textTransform: style.textTransform,
      fontSizeCalibration: {
        cssPxToPtScale: pointScale,
        correction:
          calibratedFontSizePt(fontSizePx, style, pageRect) /
          Math.max(1, fontSizePx * pointScale),
      },
    };
  }

  function rangeBoxes(range, pageRect) {
    return Array.from(range.getClientRects())
      .map((rect) => relativeRect(rect, pageRect))
      .filter((box) => box.width > 0.5 && box.height > 0.5);
  }

  function mergeLineBoxes(boxes) {
    const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];

    for (const box of sorted) {
      const centerY = box.y + box.height / 2;
      const line = lines.find(
        (candidate) =>
          Math.abs(candidate.y + candidate.height / 2 - centerY) <
          Math.max(4, Math.min(candidate.height, box.height) * 0.45),
      );

      if (!line) {
        lines.push({ ...box });
        continue;
      }

      const left = Math.min(line.x, box.x);
      const top = Math.min(line.y, box.y);
      const right = Math.max(line.x + line.width, box.x + box.width);
      const bottom = Math.max(line.y + line.height, box.y + box.height);
      Object.assign(line, {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      });
    }

    return lines.map((line, index) => ({
      ...line,
      index,
      baselineY: line.y + line.height * 0.82,
    }));
  }

  function verticalOverlap(a, b) {
    return Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  }

  function textStyleKey(style = {}) {
    return [
      style.color,
      style.fontFace,
      Math.round((style.fontSizePt ?? 0) * 100) / 100,
      style.bold ? "bold" : "regular",
      style.italic ? "italic" : "normal",
    ].join("|");
  }

  function dominantTextStyle(segments, fallbackStyle, pageRect) {
    const fallback = textStyle(fallbackStyle, pageRect);
    const styles = segments
      .map((segment) => segment.style)
      .filter((style) => Number.isFinite(style?.fontSizePx));
    if (styles.length === 0) {
      return fallback;
    }

    return styles.reduce((largest, style) =>
      style.fontSizePx > largest.fontSizePx ? style : largest,
    );
  }

  function appendLineRun(runs, segment) {
    const previous = runs[runs.length - 1];
    if (previous && textStyleKey(previous.style) === textStyleKey(segment.style)) {
      previous.text += segment.text;
      previous.boxes.push(...segment.boxes);
      previous.bounds = unionBounds(previous.boxes);
      return;
    }

    runs.push({
      text: segment.text,
      bounds: segment.bounds,
      boxes: [...segment.boxes],
      style: segment.style,
    });
  }

  function closestLineForSegment(lines, segment) {
    const segmentBox = segment.bounds;
    let best = lines[0];
    let bestScore = -Infinity;

    for (const line of lines) {
      const overlap = verticalOverlap(line, segmentBox);
      const centerDelta = Math.abs(
        line.y + line.height / 2 - (segmentBox.y + segmentBox.height / 2),
      );
      const score = overlap * 1000 - centerDelta;
      if (score > bestScore) {
        best = line;
        bestScore = score;
      }
    }

    return best;
  }

  function buildTextLines(lineBoxes, segments) {
    const lines = lineBoxes.map((line) => ({ ...line, runs: [], text: "" }));

    for (const segment of [...segments].sort((a, b) => a.order - b.order)) {
      const line = closestLineForSegment(lines, segment);
      appendLineRun(line.runs, segment);
    }

    return lines.map((line, index) => {
      const runs = line.runs
        .map((run) => ({
          ...run,
          text: run.text.replace(/[^\S\r\n]+/g, " "),
        }))
        .filter((run) => run.text.length > 0);
      if (runs.length > 0) {
        runs[0].text = runs[0].text.replace(/^[^\S\r\n]+/g, "");
        runs[runs.length - 1].text = runs[runs.length - 1].text.replace(
          /[^\S\r\n]+$/g,
          "",
        );
      }
      const visibleRuns = runs.filter((run) => run.text.length > 0);
      const text = runs
        .map((run) => run.text)
        .join("")
        .replace(/[^\S\r\n]+$/g, "")
        .replace(/^[^\S\r\n]+/g, "");

      return {
        ...line,
        index,
        text,
        runs: visibleRuns,
      };
    });
  }

  function expandBounds(bounds, pageRect, style) {
    const padX = Math.min(8, Math.max(1.5, (style.fontSizePx || 16) * 0.04));
    const padY = Math.min(3, Math.max(0.75, (style.fontSizePx || 16) * 0.025));
    const left = Math.max(0, bounds.x - padX);
    const top = Math.max(0, bounds.y - padY);
    const right = Math.min(pageRect.width, bounds.x + bounds.width + padX);
    const bottom = Math.min(pageRect.height, bounds.y + bounds.height + padY);

    return {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function boundedValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function semanticTextFrame(element, pageRect) {
    const rect = relativeRect(element.getBoundingClientRect(), pageRect);
    return {
      x: boundedValue(rect.x, 0, pageRect.width),
      y: boundedValue(rect.y, 0, pageRect.height),
      width: Math.max(0, Math.min(rect.width, pageRect.width - Math.max(0, rect.x))),
      height: Math.max(0, Math.min(rect.height, pageRect.height - Math.max(0, rect.y))),
    };
  }

  function explicitWrapValue(element) {
    const explicit = element.getAttribute("data-pptx-wrap");
    return explicit === "square" || explicit === "none" ? explicit : null;
  }

  function explicitFitValue(element) {
    const explicit = element.getAttribute("data-pptx-fit")?.toLowerCase();
    if (!explicit) {
      return null;
    }
    if (["none", "no-autofit", "shrink", "resize", "shape"].includes(explicit)) {
      return explicit;
    }
    return null;
  }

  function shouldWrapSemanticText(element, style, lineCount, centerInNativeShape) {
    const explicit = explicitWrapValue(element);
    if (explicit) {
      return explicit === "square";
    }
    if (centerInNativeShape) {
      return false;
    }

    const whiteSpace = style.whiteSpace;
    if (whiteSpace === "nowrap" || whiteSpace === "pre") {
      return false;
    }

    return (
      element.hasAttribute("data-pptx-text") ||
      isSemanticTextContainer(element) ||
      lineCount > 1
    );
  }

  function textFrameMargins({ frameBounds, inkBounds, style, useSemanticFrame }) {
    if (!useSemanticFrame) {
      return { leftPx: 0, topPx: 0, rightPx: 0, bottomPx: 0 };
    }

    const paddingLeft = parsePixels(style.paddingLeft);
    const paddingTop = parsePixels(style.paddingTop);
    const paddingRight = parsePixels(style.paddingRight);
    const paddingBottom = parsePixels(style.paddingBottom);
    const measuredLeft = Math.max(0, inkBounds.x - frameBounds.x);
    const measuredTop = Math.max(0, inkBounds.y - frameBounds.y);
    const useMeasuredLeft =
      style.textAlign !== "center" &&
      style.textAlign !== "right" &&
      style.textAlign !== "end";

    return {
      leftPx: useMeasuredLeft ? Math.max(paddingLeft, measuredLeft) : paddingLeft,
      topPx: Math.max(paddingTop, measuredTop),
      rightPx: paddingRight,
      bottomPx: paddingBottom,
    };
  }

  function textSegmentsForNode(node, style, pageRect, firstOrder) {
    const rawText = node.textContent ?? "";
    const matches = Array.from(rawText.matchAll(/[^\S\r\n]+|\S+[^\S\r\n]*/g));
    const segments = [];

    for (const [index, match] of matches.entries()) {
      const sourceText = match[0];
      const start = match.index ?? 0;
      const end = start + sourceText.length;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const boxes = rangeBoxes(range, pageRect);
      range.detach();

      if (boxes.length === 0) {
        continue;
      }

      const text = renderedText(sourceText, style, { trim: false });
      if (text.length === 0) {
        continue;
      }

      segments.push({
        text,
        bounds: unionBounds(boxes),
        boxes,
        style: textStyle(style, pageRect),
        order: firstOrder + index,
      });
    }

    return segments;
  }

  function isSemanticTextContainer(element) {
    const tagName = element.tagName.toLowerCase();
    return (
      element.hasAttribute("data-pptx-text") ||
      /^(h[1-6]|p|li|button|a|label|figcaption|blockquote|td|th)$/.test(tagName)
    );
  }

  function hasMultipleTextChildBlocks(element) {
    let count = 0;

    for (const child of Array.from(element.children)) {
      if (!isElementVisible(child)) {
        continue;
      }

      if (!(child.innerText ?? child.textContent ?? "").trim()) {
        continue;
      }

      const display = window.getComputedStyle(child).display;
      if (/^(block|flex|grid|list-item|table|inline-block)$/.test(display)) {
        count += 1;
      }

      if (count > 1) {
        return true;
      }
    }

    return false;
  }

  function textContainerForNode(node, pageElement) {
    let current = node.parentElement;
    let best = current;

    while (current && current !== pageElement) {
      if (
        current.hasAttribute("data-pptx-native") &&
        !hasMultipleTextChildBlocks(current)
      ) {
        return current;
      }

      if (current.hasAttribute("data-pptx-text")) {
        return current;
      }

      const parent = current.parentElement;
      if (!parent || parent === pageElement) {
        return current;
      }

      if (parent.hasAttribute("data-pptx-native")) {
        return hasMultipleTextChildBlocks(parent) ? current : parent;
      }

      if (hasMultipleTextChildBlocks(parent)) {
        return current;
      }

      if (isSemanticTextContainer(parent)) {
        best = parent;
      }

      current = parent;
    }

    return best;
  }

  function centeredNativeTextShape(element) {
    const nativeKind = element.getAttribute("data-pptx-native");
    return nativeKind === "button-or-badge" || nativeKind === "progress-bar";
  }

  function isNestedTextGroup(child, parent) {
    return (
      child !== parent &&
      parent.contains(child) &&
      !hasMultipleTextChildBlocks(child) &&
      !hasMultipleTextChildBlocks(parent)
    );
  }

  function collectTextElements(pageElement, domOrder) {
    const pageRect = pageElement.getBoundingClientRect();
    const groups = new Map();
    const walker = document.createTreeWalker(
      pageElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.textContent) {
            return NodeFilter.FILTER_REJECT;
          }

          const parent = node.parentElement;
          if (!parent || !isElementVisible(parent)) {
            return NodeFilter.FILTER_REJECT;
          }

          if (parent.closest("script,style,noscript")) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      const style = window.getComputedStyle(parent);
      const color = parseRgb(style.color);
      const text = renderedText(node.textContent ?? "", style, { trim: false });
      const fontSizePx = Number.parseFloat(style.fontSize);

      if (text && color && Number.isFinite(fontSizePx) && fontSizePx >= 4) {
        const segments = textSegmentsForNode(
          node,
          style,
          pageRect,
          0,
        );
        const boxes = segments.flatMap((segment) => segment.boxes);

        if (boxes.length > 0) {
          const container = textContainerForNode(node, pageElement);
          const group = groups.get(container) ?? {
            element: container,
            segments: [],
            boxes: [],
            textNodeCount: 0,
            segmentCount: 0,
          };
          const orderedSegments = segments.map((segment, index) => ({
            ...segment,
            order: group.segmentCount + index,
          }));
          group.segments.push(...orderedSegments);
          group.boxes.push(...boxes);
          group.textNodeCount += 1;
          group.segmentCount += orderedSegments.length;
          groups.set(container, group);
        }
      }

      node = walker.nextNode();
    }

    const dedupedGroups = Array.from(groups.values()).filter(
      (group, _index, allGroups) =>
        !allGroups.some((candidate) =>
          isNestedTextGroup(group.element, candidate.element),
        ),
    );

    return dedupedGroups.map((group) => {
      const element = group.element;
      const style = window.getComputedStyle(element);
      const elementTextStyle = dominantTextStyle(group.segments, style, pageRect);
      const centerInNativeShape = centeredNativeTextShape(element);
      const base = baseElementData("text", element, pageRect, domOrder, {
        pageElement,
        suffix: "text",
        confidence: "high",
        reason: "grouped visible text nodes with measured range boxes",
      });
      const lineBoxes = mergeLineBoxes(group.boxes);
      const textLines = buildTextLines(lineBoxes, group.segments);
      const inkBounds = unionBounds(lineBoxes);
      const semanticFrameBounds = semanticTextFrame(element, pageRect);
      const wrapText = shouldWrapSemanticText(
        element,
        style,
        textLines.length,
        centerInNativeShape,
      );
      const useSemanticFrame = centerInNativeShape || wrapText;
      const bounds = useSemanticFrame
        ? semanticFrameBounds
        : expandBounds(inkBounds, pageRect, elementTextStyle);
      const fit = explicitFitValue(element) ?? (wrapText ? "shrink" : "no-autofit");
      const grouping = {
        strategy: "nearest-semantic-text-container",
        containerId: base.domId,
        parentId: base.parentId,
        groupId: base.groupId,
        runCount: textLines.reduce((count, line) => count + line.runs.length, 0),
        lineCount: textLines.length,
        rangeBoxCount: group.boxes.length,
        textNodeCount: group.textNodeCount,
        segmentCount: group.segmentCount,
      };
      return {
        ...base,
        bounds,
        classification: "visible-text",
        nativeKind: "visible-text",
        role:
          element.getAttribute("role") ??
          element.getAttribute("data-pptx-role") ??
          "",
        grouping,
        text: {
          content:
            textLines.map((line) => line.text).join("\n") ||
            renderedText(element.innerText ?? element.textContent ?? "", style, {
              preserveLineBreaks: true,
            }),
          style: elementTextStyle,
          runs: textLines.flatMap((line) =>
            line.runs.map((run) => ({ ...run, lineIndex: line.index })),
          ),
          lines: textLines,
          paragraph: {
            align: centerInNativeShape ? "center" : elementTextStyle.align,
            verticalAlign: centerInNativeShape ? "middle" : "top",
            wrap: wrapText ? "square" : "none",
            fit,
            margins: textFrameMargins({
              frameBounds: bounds,
              inkBounds,
              style,
              useSemanticFrame,
            }),
          },
          frame: {
            strategy: useSemanticFrame ? "semantic-container" : "measured-ink",
            bounds,
            inkBounds,
            semanticBounds: semanticFrameBounds,
          },
          grouping,
        },
      };
    });
  }

  function parsePixels(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function borderWidths(style) {
    return {
      top: parsePixels(style.borderTopWidth),
      right: parsePixels(style.borderRightWidth),
      bottom: parsePixels(style.borderBottomWidth),
      left: parsePixels(style.borderLeftWidth),
    };
  }

  function borderWidth(style) {
    return Math.max(...Object.values(borderWidths(style)));
  }

  function radiusValues(style) {
    return {
      topLeftPx: parsePixels(style.borderTopLeftRadius),
      topRightPx: parsePixels(style.borderTopRightRadius),
      bottomRightPx: parsePixels(style.borderBottomRightRadius),
      bottomLeftPx: parsePixels(style.borderBottomLeftRadius),
    };
  }

  function maxRadius(style) {
    return Math.max(...Object.values(radiusValues(style)));
  }

  function colorOrNull(value) {
    return parseRgb(value, null);
  }

  function hasVisibleFill(style) {
    return colorOrNull(style.backgroundColor) !== null;
  }

  function hasBackgroundImage(style) {
    return Boolean(style.backgroundImage && style.backgroundImage !== "none");
  }

  function hasComplexEffect(style) {
    return (
      (style.filter && style.filter !== "none") ||
      (style.backdropFilter && style.backdropFilter !== "none") ||
      (style.mixBlendMode && style.mixBlendMode !== "normal")
    );
  }

  function signalText(element) {
    const source = sourceForElement(element);
    return [
      source.tagName,
      source.className,
      source.role,
      source.ariaLabel,
      source.title,
      source.href,
      source.dataPptxNative,
      source.dataPptxRole,
      element.getAttribute("alt") ?? "",
      element.getAttribute("src") ?? "",
      element.getAttribute("data-testid") ?? "",
    ]
      .join(" ")
      .toLowerCase();
  }

  function isMediaElement(element) {
    return /^(img|svg|canvas|video|iframe|picture)$/.test(
      element.tagName.toLowerCase(),
    );
  }

  function isPageChrome(element, pageElement) {
    const rect = element.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    return rect.width > pageRect.width * 0.92 && rect.height > pageRect.height * 0.92;
  }

  function isThinHorizontal(bounds) {
    return bounds.width >= 12 && bounds.height > 0 && bounds.height <= 6;
  }

  function isThinVertical(bounds) {
    return bounds.height >= 12 && bounds.width > 0 && bounds.width <= 6;
  }

  function looksLikeLine(element, style, bounds) {
    const signals = signalText(element);
    const tagName = element.tagName.toLowerCase();
    return (
      tagName === "hr" ||
      /\b(separator|divider|rule|line)\b/.test(signals) ||
      ((isThinHorizontal(bounds) || isThinVertical(bounds)) &&
        (hasVisibleFill(style) || borderWidth(style) > 0))
    );
  }

  function looksLikeProgressBar(element, style, bounds) {
    const signals = signalText(element);
    if (/\b(progress|meter)\b/.test(signals)) {
      return true;
    }

    if (!isThinHorizontal(bounds) || !hasVisibleFill(style)) {
      return false;
    }

    const parent = element.parentElement;
    if (!parent || !isElementVisible(parent)) {
      return false;
    }

    const parentRect = parent.getBoundingClientRect();
    const parentStyle = window.getComputedStyle(parent);
    const isTrack =
      parentRect.width >= bounds.width &&
      parentRect.height <= Math.max(18, bounds.height + 8) &&
      (hasVisibleFill(parentStyle) || borderWidth(parentStyle) > 0);
    const hasFillChild = Array.from(element.children).some((child) => {
      if (!isElementVisible(child)) {
        return false;
      }
      const childRect = child.getBoundingClientRect();
      const childStyle = window.getComputedStyle(child);
      return (
        isThinHorizontal(childRect) &&
        hasVisibleFill(childStyle) &&
        childRect.width <= bounds.width + 1
      );
    });

    return isTrack || hasFillChild;
  }

  function looksLikeButtonBadge(element, style, bounds) {
    const signals = signalText(element);
    const tagName = element.tagName.toLowerCase();
    const hasControlRole =
      /^(button|a|summary)$/.test(tagName) ||
      /\b(button|tab|link|menuitem|switch|checkbox)\b/.test(signals);
    const hasBadgeClass = /\b(badge|pill|chip|tag|token|label|cta|control)\b/.test(
      signals,
    );
    const rounded = maxRadius(style) >= 2;
    const hasChrome = hasVisibleFill(style) || borderWidth(style) > 0;
    const containsText = Boolean((element.innerText ?? element.textContent ?? "").trim());

    return (
      hasChrome &&
      rounded &&
      bounds.width >= 12 &&
      bounds.height >= 8 &&
      (hasControlRole || hasBadgeClass || (containsText && bounds.height <= 64))
    );
  }

  function looksLikeCssIcon(element, style, bounds) {
    const signals = signalText(element);
    const containsText = Boolean((element.innerText ?? element.textContent ?? "").trim());
    const diameter = Math.max(bounds.width, bounds.height);
    return (
      !containsText &&
      hasVisibleFill(style) &&
      diameter >= 4 &&
      diameter <= 80 &&
      maxRadius(style) >= Math.min(bounds.width, bounds.height) / 2 - 1 &&
      /\b(dot|icon|avatar|indicator|status|rounded-full)\b/.test(signals)
    );
  }

  function looksLikeCardPanel(element, style, bounds, pageElement) {
    if (isPageChrome(element, pageElement)) {
      return false;
    }

    const signals = signalText(element);
    const widths = borderWidths(style);
    const sideCount = Object.values(widths).filter((width) => width > 0).length;
    const hasOnlyOneSidedBorder = sideCount > 0 && sideCount < 4;
    const hasChrome =
      borderWidth(style) > 0 ||
      maxRadius(style) >= 4 ||
      (style.boxShadow && style.boxShadow !== "none") ||
      /\b(card|panel|box|tile|surface|popover|dialog|bg-card|shadow)\b/.test(
        signals,
      );

    return (
      hasChrome &&
      !hasOnlyOneSidedBorder &&
      (hasVisibleFill(style) || borderWidth(style) > 0) &&
      bounds.width >= 40 &&
      bounds.height >= 24 &&
      !looksLikeLine(element, style, bounds)
    );
  }

  function classifyNativeElement(element, pageElement) {
    if (!isElementVisible(element) || element === pageElement) {
      return null;
    }

    if (isMediaElement(element) || element.closest("svg")) {
      return null;
    }

    const style = window.getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const explicit = element.getAttribute("data-pptx-native");
    if (explicit && explicit !== "visible-text") {
      return {
        classification: explicit,
        reason: `explicit data-pptx-native=${explicit}`,
        confidence: "high",
      };
    }

    if (looksLikeProgressBar(element, style, bounds)) {
      return {
        classification: "progress-bar",
        reason: "thin horizontal track/fill progress bar heuristic",
        confidence: "medium",
      };
    }

    if (looksLikeLine(element, style, bounds)) {
      return {
        classification: "border-or-line",
        reason: "divider/rule/thin-line heuristic",
        confidence: "medium",
      };
    }

    if (looksLikeButtonBadge(element, style, bounds)) {
      return {
        classification: "button-or-badge",
        reason: "control/badge style heuristic",
        confidence: "medium",
      };
    }

    if (looksLikeCssIcon(element, style, bounds)) {
      return {
        classification: "simple-svg-or-icon",
        reason: "small rounded CSS icon heuristic",
        confidence: "medium",
      };
    }

    if (looksLikeCardPanel(element, style, bounds, pageElement)) {
      return {
        classification: "card-or-box",
        reason: "card/panel chrome heuristic",
        confidence: "medium",
      };
    }

    return null;
  }

  function shapeStyleForElement(element, classification) {
    const style = window.getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const lineWidthPx = borderWidth(style);
    const lineLike =
      classification === "border-or-line" || classification === "progress-bar";
    const fillColor = colorOrNull(style.backgroundColor);
    const strokeColor = lineWidthPx > 0 ? colorOrNull(style.borderTopColor) : null;
    const visibleColor = fillColor ?? strokeColor;
    const radius = radiusValues(style);
    const maxRadiusPx = Math.max(...Object.values(radius));
    const looksCircular =
      Math.abs(bounds.width - bounds.height) <= 1 &&
      maxRadiusPx >= Math.min(bounds.width, bounds.height) / 2 - 1;

    return {
      preset:
        looksCircular ? "ellipse" : "rect",
      fill: {
        color: lineLike ? visibleColor : fillColor,
        opacity: visibleColor ? Number(style.opacity) || 1 : 0,
      },
      stroke: {
        color: lineLike ? null : strokeColor,
        widthPx: lineLike ? 0 : lineWidthPx,
        dash: style.borderTopStyle,
      },
      radius,
    };
  }

  function collectShapeObjects(pageElement, domOrder) {
    const pageRect = pageElement.getBoundingClientRect();

    return Array.from(pageElement.querySelectorAll("*"))
      .filter((element) => element !== pageElement)
      .map((element) => {
        const classification = classifyNativeElement(element, pageElement);
        if (!classification) {
          return null;
        }

        const kind = classification.classification;
        return {
          ...baseElementData("shape", element, pageRect, domOrder, {
            pageElement,
            suffix: kind,
            confidence: classification.confidence,
            reason: classification.reason,
          }),
          classification: kind,
          kind,
          dataPptxNative: element.getAttribute("data-pptx-native") ?? kind,
          shapeStyle: shapeStyleForElement(element, kind),
          containsText: Boolean((element.textContent ?? "").trim()),
          label:
            element.getAttribute("aria-label") ??
            element.getAttribute("title") ??
            "",
        };
      })
      .filter(Boolean);
  }

  function borderLineData(element, pageElement, domOrder) {
    if (!isElementVisible(element) || isMediaElement(element)) {
      return [];
    }

    const style = window.getComputedStyle(element);
    const widths = borderWidths(style);
    const sides = Object.entries(widths).filter(([, width]) => width > 0);
    const signals = signalText(element);
    const oneSided =
      sides.length > 0 &&
      sides.length < 4 &&
      /\bborder-[trblxy]\b/.test(signals);
    if (!oneSided) {
      return [];
    }

    const pageRect = pageElement.getBoundingClientRect();
    const rect = relativeRect(element.getBoundingClientRect(), pageRect);
    const colors = {
      top: colorOrNull(style.borderTopColor),
      right: colorOrNull(style.borderRightColor),
      bottom: colorOrNull(style.borderBottomColor),
      left: colorOrNull(style.borderLeftColor),
    };
    const borderStyles = {
      top: style.borderTopStyle,
      right: style.borderRightStyle,
      bottom: style.borderBottomStyle,
      left: style.borderLeftStyle,
    };

    return sides
      .map(([side, width]) => {
        const color = colors[side];
        if (!color) {
          return null;
        }

        const bounds =
          side === "top"
            ? { x: rect.x, y: rect.y, width: rect.width, height: width }
            : side === "bottom"
              ? {
                  x: rect.x,
                  y: rect.y + rect.height - width,
                  width: rect.width,
                  height: width,
                }
              : side === "left"
                ? { x: rect.x, y: rect.y, width, height: rect.height }
                : {
                    x: rect.x + rect.width - width,
                    y: rect.y,
                    width,
                    height: rect.height,
                  };

        return {
          ...baseElementData("shape", element, pageRect, domOrder, {
            pageElement,
            id: elementManifestId(element, "shape", domOrder, `border-${side}`),
            suffix: `border-${side}`,
            confidence: "high",
            reason: `computed ${side} border side`,
          }),
          bounds,
          classification: "border-or-line",
          kind: "border-or-line",
          shapeStyle: {
            preset: "rect",
            fill: { color: null, opacity: 0 },
            stroke: {
              color,
              widthPx: width,
              opacity: Number(style.opacity) || 1,
              dash: borderStyles[side],
            },
            radius: {
              topLeftPx: 0,
              topRightPx: 0,
              bottomRightPx: 0,
              bottomLeftPx: 0,
            },
          },
          containsText: false,
          label: `${side} border`,
        };
      })
      .filter(Boolean);
  }

  function collectBorderLineObjects(pageElement, domOrder) {
    return Array.from(pageElement.querySelectorAll("*")).flatMap((element) =>
      borderLineData(element, pageElement, domOrder),
    );
  }

  function svgGeometryMetadata(element) {
    const geometry = Array.from(
      element.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon"),
    );
    const paths = geometry
      .map((part) => ({
        d: part.getAttribute("d") ?? "",
        fill: part.getAttribute("fill") ?? "",
        stroke: part.getAttribute("stroke") ?? "",
        strokeWidth: part.getAttribute("stroke-width") ?? "",
      }))
      .filter((part) => part.d);
    const colors = [
      ...new Set(
        geometry
          .map((part) => part.getAttribute("fill") ?? part.getAttribute("stroke"))
          .filter(Boolean)
          .map((color) => color.replace(/^#/, "").toUpperCase()),
      ),
    ];

    return {
      viewBox: element.getAttribute("viewBox") ?? "",
      geometryCount: geometry.length,
      colors,
      paths,
      markup: element.outerHTML.slice(0, 20000),
    };
  }

  function svgLooksLikeMicrosoftLogo(element) {
    const colors = svgGeometryMetadata(element).colors.map((color) =>
      color.toLowerCase(),
    );
    return ["f1511b", "80cc28", "00adef", "fbbc09"].every((color) =>
      colors.includes(color),
    );
  }

  function logoClassification(element) {
    const signals = signalText(element);
    if (
      /\b(microsoft|msft|account|customer|brand|logo|lockup)\b/.test(signals) ||
      (element.tagName.toLowerCase() === "svg" && svgLooksLikeMicrosoftLogo(element))
    ) {
      return "microsoft-or-account-logo";
    }

    return null;
  }

  function svgIsSimple(element) {
    const complexParts = element.querySelector(
      "filter,mask,pattern,foreignObject,image,video,canvas",
    );
    const geometryCount = element.querySelectorAll(
      "path,rect,circle,ellipse,line,polyline,polygon",
    ).length;

    return !complexParts && geometryCount > 0 && geometryCount <= 24;
  }

  function collectMediaObjects(pageElement, domOrder) {
    const pageRect = pageElement.getBoundingClientRect();

    return Array.from(pageElement.querySelectorAll("img,svg"))
      .filter(isElementVisible)
      .map((element) => {
        const tagName = element.tagName.toLowerCase();
        const isSvg = tagName === "svg";
        const simpleSvg = isSvg && svgIsSimple(element);
        const logoKind = logoClassification(element);
        const svgMetadata = isSvg ? svgGeometryMetadata(element) : null;
        const firstPath = svgMetadata?.paths?.[0];
        const classification = logoKind
          ? logoKind
          : simpleSvg
            ? "simple-svg-or-icon"
            : isSvg
              ? "complex-svg-or-icon"
              : "photo-or-complex-image";
        const nativeAsset = Boolean(
          logoKind ||
            simpleSvg ||
            element.currentSrc ||
            element.src ||
            element.getAttribute("src"),
        );
        return {
          ...baseElementData(
            isSvg ? "vector" : "image",
            element,
            pageRect,
            domOrder,
            {
              pageElement,
              suffix: classification,
              confidence: logoKind || simpleSvg ? "high" : "medium",
              reason: logoKind
                ? "logo/image source heuristic"
                : simpleSvg
                  ? "simple inline SVG geometry heuristic"
                  : "bounded image asset",
              suppressScreenshotFallback: nativeAsset,
            },
          ),
          classification,
          kind:
            classification === "photo-or-complex-image"
              ? undefined
              : classification,
          nativeAsset,
          src: element.currentSrc || element.src || element.getAttribute("src") || "",
          alt: element.getAttribute("alt") ?? "",
          naturalWidth: element.naturalWidth || element.clientWidth || 0,
          naturalHeight: element.naturalHeight || element.clientHeight || 0,
          containsVisibleText: Boolean(
            isSvg && element.querySelector("text,foreignObject"),
          ),
          svg: svgMetadata,
          vector: isSvg
            ? {
                viewBox: svgMetadata?.viewBox ?? "",
                paths: svgMetadata?.paths ?? [],
                svgPath: firstPath?.d ?? "",
              }
            : null,
          shapeStyle:
            isSvg && firstPath
              ? {
                  fill: {
                    color: colorOrNull(firstPath.fill) ?? null,
                    opacity: firstPath.fill === "none" ? 0 : 1,
                  },
                  stroke: {
                    color:
                      colorOrNull(firstPath.stroke) ??
                      colorOrNull(element.getAttribute("stroke")) ??
                      "0D0D0D",
                    widthPx:
                      Number.parseFloat(firstPath.strokeWidth) ||
                      Number.parseFloat(element.getAttribute("stroke-width") ?? "") ||
                      2,
                  },
                  radius: {
                    topLeftPx: 0,
                    topRightPx: 0,
                    bottomRightPx: 0,
                    bottomLeftPx: 0,
                  },
                }
              : null,
          fallback: nativeAsset
            ? {
                kind: null,
                reason:
                  "Captured as a native picture/vector asset; no baked slide screenshot required.",
              }
            : {
                kind: isSvg ? "complex-svg-or-icon" : "photo-or-complex-image",
                reason:
                  "Complex media captured as a bounded raster-capable region.",
              },
        };
      });
  }

  function fallbackKindForElement(element) {
    const tagName = element.tagName.toLowerCase();
    if (tagName === "canvas") {
      return "canvas-or-webgl";
    }
    if (tagName === "video") {
      return "video-frame";
    }
    if (tagName === "iframe") {
      return "complex-chart-or-data-visualization";
    }
    return "complex-css-effect-region";
  }

  function shouldCaptureFallback(element, pageElement) {
    if (!isElementVisible(element) || element === pageElement) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    if (/^(canvas|video|iframe)$/.test(tagName)) {
      return true;
    }

    if (element.hasAttribute("data-pptx-fallback")) {
      return true;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      (hasBackgroundImage(style) || hasComplexEffect(style)) &&
      rect.width >= 24 &&
      rect.height >= 24 &&
      !isPageChrome(element, pageElement)
    );
  }

  function collectFallbackObjects(pageElement, domOrder) {
    const pageRect = pageElement.getBoundingClientRect();

    return Array.from(pageElement.querySelectorAll("*"))
      .filter((element) => shouldCaptureFallback(element, pageElement))
      .map((element) => {
        const kind =
          element.getAttribute("data-pptx-fallback") ||
          fallbackKindForElement(element);
        const containsVisibleText = Boolean(
          (element.innerText ?? element.textContent ?? "").trim(),
        );
        return {
          ...baseElementData("fallback", element, pageRect, domOrder, {
            pageElement,
            suffix: kind,
            confidence: "high",
            suppressScreenshotFallback: false,
            reason: `bounded fallback region: ${kind}`,
            fallbackReason:
              element.getAttribute("data-pptx-fallback-reason") ||
              "No native DOM primitive matched this element.",
          }),
          classification: kind,
          kind,
          containsVisibleText,
          coversFullSlide: isPageChrome(element, pageElement),
          reason:
            element.getAttribute("data-pptx-fallback-reason") ||
            "No native DOM primitive matched this element.",
          diagnostics: [
            {
              level: containsVisibleText ? "warning" : "info",
              code: "bounded-raster-fallback",
              message:
                "Element requires an isolated raster fallback because capture could not map it to native text, shape, image, or vector primitives.",
            },
          ],
        };
      });
  }

  return Array.from(document.querySelectorAll(".pdf-export-page")).map(
    (pageElement, index) => {
      const rect = pageElement.getBoundingClientRect();
      const domOrder = buildDomOrder(pageElement);
      const elements = [
        ...collectShapeObjects(pageElement, domOrder),
        ...collectBorderLineObjects(pageElement, domOrder),
        ...collectMediaObjects(pageElement, domOrder),
        ...collectFallbackObjects(pageElement, domOrder),
        ...collectTextElements(pageElement, domOrder),
      ];
      return {
        id:
          pageElement.getAttribute("data-pptx-slide-id") ||
          `slide-${index + 1}`,
        index,
        width: rect.width,
        height: rect.height,
        elements,
        rasterFallbackRegions: [],
      };
    },
  );
}

function elementFallbackKind(element) {
  return (
    element.fallback?.kind ??
    element.kind ??
    element.classification ??
    "photo-or-complex-image"
  );
}

function elementCoversSlide(element, slide) {
  const bounds = element.bounds ?? element;
  return (
    bounds.x <= 1 &&
    bounds.y <= 1 &&
    bounds.width >= slide.width - 2 &&
    bounds.height >= slide.height - 2
  );
}

function hasRasterPayload(element) {
  return Boolean(
    element.data ??
      element.base64 ??
      element.assetRef?.data ??
      element.assetRef?.base64,
  );
}

function shouldAttachRasterPayload(element, slide, mode) {
  if (hasRasterPayload(element)) {
    return false;
  }

  if (element.type === "image") {
    return !elementCoversSlide(element, slide);
  }

  const kind = elementFallbackKind(element);
  const containsVisibleText = Boolean(element.containsVisibleText);
  const coversFullSlide =
    Boolean(element.coversFullSlide) || elementCoversSlide(element, slide);
  const fallbackIsAllowed = isAllowedRasterFallback({
    mode,
    kind,
    containsVisibleText,
    coversFullSlide,
  });

  return (
    fallbackIsAllowed &&
    (element.type === "fallback" ||
      ((element.type === "vector" || element.type === "image") &&
        element.fallback?.kind))
  );
}

function boundedClip(pageBox, bounds) {
  const x = Math.max(0, bounds.x);
  const y = Math.max(0, bounds.y);
  const width = Math.min(bounds.width, pageBox.width - x);
  const height = Math.min(bounds.height, pageBox.height - y);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: pageBox.x + x,
    y: pageBox.y + y,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

async function attachRasterPayloads(page, slides, mode) {
  const pageHandles = await page.locator(".pdf-export-page").elementHandles();

  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];
    const pageBox = await pageHandles[index]?.boundingBox();
    if (!pageBox) {
      continue;
    }

    for (const element of slide.elements ?? []) {
      if (!shouldAttachRasterPayload(element, slide, mode)) {
        continue;
      }

      const clip = boundedClip(pageBox, element.bounds ?? element);
      if (!clip) {
        continue;
      }

      try {
        const data = await page.screenshot({ type: "png", clip });
        element.assetRef = {
          ...(element.assetRef ?? {}),
          id: element.assetRef?.id ?? `${element.id}-raster`,
          kind: "image",
          mimeType: "image/png",
          altText:
            element.assetRef?.altText ??
            element.alt ??
            element.label ??
            element.source?.ariaLabel ??
            element.role ??
            element.id,
          intrinsic: {
            width: Math.round(clip.width),
            height: Math.round(clip.height),
          },
          data,
        };
        element.image = {
          fit: "stretch",
          ...(element.image ?? {}),
        };
        element.capture = {
          ...(element.capture ?? {}),
          rasterizedFallback: true,
        };
      } catch (error) {
        element.diagnostics = [
          ...(element.diagnostics ?? []),
          {
            level: "warning",
            code: "raster-fallback-capture-failed",
            message: `Could not capture bounded raster fallback: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ];
      }
    }
  }
}

export async function captureDeck({ url, mode = DEFAULT_EXPORT_MODE }) {
  const exportMode = normalizeExportMode(mode);
  const browser = await launchBrowser();

  try {
    const page = await openExportDeckPage(browser, buildExportUrls(url));
    await waitForReady(page);
    await waitForExportSettled(page);

    const rawSlides = await page.evaluate(captureScript);
    if (rawSlides.length === 0) {
      throw new Error("No export pages were found for editable PPTX export.");
    }

    await attachRasterPayloads(page, rawSlides, exportMode);

    if (isDebugFidelityMode(exportMode)) {
      rawSlides.forEach((slide) => {
        slide.rasterFallbackRegions.push(createDebugFullSlideFallback(slide));
      });

      const pageHandles = await page
        .locator(".pdf-export-page")
        .elementHandles();
      for (let index = 0; index < pageHandles.length; index += 1) {
        rawSlides[index].backgroundPng = await pageHandles[index].screenshot({
          type: "png",
        });
      }
    }

    const manifest = normalizeCapturedDeckToManifest(
      { mode: exportMode, slides: rawSlides },
      { mode: exportMode },
    );

    await page.close();
    return { mode: exportMode, manifest, slides: manifest.slides };
  } finally {
    await browser.close();
  }
}

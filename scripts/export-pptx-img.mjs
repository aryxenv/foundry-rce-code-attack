import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const pptxgen = require("pptxgenjs");

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultOutput = path.join(repoRoot, "exports", "webslides-img.pptx");
const slideWidth = 13.333;
const slideHeight = 7.5;
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const fallbackPorts = ["5173", "5174", "5175", "5176"];

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function resolveOutput(output) {
  return path.isAbsolute(output) ? output : path.join(repoRoot, output);
}

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

async function openExportDeckPage(browser, urls, pageOptions) {
  const errors = [];

  for (const url of urls) {
    const page = await browser.newPage(pageOptions);

    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (response && !response.ok()) {
        throw new Error(`Server responded ${response.status()}`);
      }

      if (url !== urls[0]) {
        console.warn(`Primary export URL was unavailable; using ${url}`);
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
      "Could not reach the local web deck for image PPTX export.",
      "Start the client with `npm run dev` and retry.",
      ...errors,
    ].join("\n"),
  );
}

async function waitForExportSettled(page, exportLabel) {
  try {
    await page.waitForFunction(
      () => {
        const root =
          document.querySelector(".pdf-export-deck") ?? document.body;
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
        const hasPendingElement = pendingSelectors.some((selector) =>
          Array.from(root.querySelectorAll(selector)).some(isVisible),
        );
        if (hasPendingElement) {
          return false;
        }

        const loadingText =
          /^(loading(?:\.{1,3}|\u2026)?|checking server(?:\.{1,3}|\u2026)?|calling(?:\.{1,3}|\u2026)?)$/i;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
          if (loadingText.test(text)) {
            const parent = node.parentElement;
            if (parent && isVisible(parent)) {
              return false;
            }
          }

          node = walker.nextNode();
        }

        return true;
      },
      null,
      { timeout: 30000 },
    );
  } catch (error) {
    throw new Error(
      [
        `${exportLabel} export did not settle before capture.`,
        "A visible loading indicator is still present in the export deck.",
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
    );
  }

  await page.waitForTimeout(250);
}

async function launchBrowser() {
  const configuredChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
  if (configuredChannel) {
    return chromium.launch({ channel: configuredChannel });
  }

  try {
    return await chromium.launch({ channel: "msedge" });
  } catch (edgeError) {
    try {
      return await chromium.launch();
    } catch (chromiumError) {
      throw new Error(
        [
          "Could not launch a browser for image PPTX export.",
          "Install Chromium with `npx playwright install chromium`, or set PLAYWRIGHT_BROWSER_CHANNEL to an installed browser channel.",
          `Edge launch error: ${edgeError instanceof Error ? edgeError.message : String(edgeError)}`,
          `Chromium launch error: ${chromiumError instanceof Error ? chromiumError.message : String(chromiumError)}`,
        ].join("\n"),
      );
    }
  }
}

const baseUrl = readOption("--url", "http://localhost:5173/");
const outputPath = resolveOutput(readOption("--output", defaultOutput));
const exportUrls = buildExportUrls(baseUrl);

await mkdir(path.dirname(outputPath), { recursive: true });

const browser = await launchBrowser();
try {
  const page = await openExportDeckPage(browser, exportUrls, {
    deviceScaleFactor: 2,
    viewport: { width: 1920, height: 1080 },
  });

  await page.waitForFunction(
    () =>
      window.__webslidesExportReady === true ||
      document.documentElement.dataset.webslidesExportReady === "true",
    null,
    { timeout: 30000 },
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
  await waitForExportSettled(page, "Image PPTX");

  const pages = await page.locator(".pdf-export-page").elementHandles();
  if (pages.length === 0) {
    throw new Error("No export pages were found for image PPTX export.");
  }

  const pptx = new pptxgen();
  pptx.defineLayout({
    name: "WEB_WIDE",
    width: slideWidth,
    height: slideHeight,
  });
  pptx.layout = "WEB_WIDE";
  pptx.author = "GitHub Copilot";
  pptx.company = "Microsoft";
  pptx.subject = "Webslides image export";
  pptx.title = "Webslides";
  pptx.lang = "en-US";
  pptx.margin = 0;

  for (const slidePage of pages) {
    const screenshot = await slidePage.screenshot({ type: "png" });
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addImage({
      data: `data:image/png;base64,${screenshot.toString("base64")}`,
      x: 0,
      y: 0,
      w: slideWidth,
      h: slideHeight,
    });
  }

  await pptx.writeFile({ fileName: outputPath });
} finally {
  await browser.close();
}

console.log(`Image PPTX exported to ${outputPath}`);

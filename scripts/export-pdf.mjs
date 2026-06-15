import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultOutput = path.join(repoRoot, "exports", "webslides.pdf");
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
      "Could not reach the local web deck for PDF export.",
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
          "Could not launch a browser for PDF export.",
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
    viewport: { width: 1920, height: 1080 },
  });

  await page.emulateMedia({ media: "print" });
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
  await waitForExportSettled(page, "PDF");
  await page.pdf({
    path: outputPath,
    width: "13.333333in",
    height: "7.5in",
    printBackground: true,
    preferCSSPageSize: true,
    margin: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
  });
} finally {
  await browser.close();
}

console.log(`PDF exported to ${outputPath}`);

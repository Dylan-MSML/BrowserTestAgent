import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import open from "open";
import getDomRepresentation from "./utils/dom-representation";
import type { Tool } from "../types";
let browserInstance: Browser | null = null;
let contextInstance: BrowserContext | null = null;
let pageInstance: Page | null = null;

export const sumTool = async (args: string): Promise<string> => {
  try {
    const result = eval(args);
    return `Result: ${result}`;
  } catch {
    return "Error evaluating expression.";
  }
};

export const visitWebsite = async (args: string): Promise<string> => {
  try {
    await open(args.startsWith("http") ? args : "https://" + args);
    return `Opening website: ${
      args.startsWith("http") ? args : "https://" + args
    }`;
  } catch {
    return "Error opening website.";
  }
};

/**
 * Advanced DOM representation tool that runs the large buildDomTree snippet
 * to identify interactive elements, handle iframes/shadowDOM, optionally
 * highlight, etc. Returns a big JSON structure.
 */
export const getInteractiveDomRepresentation = async (
  url: string,
): Promise<string> => {
  if (!browserInstance || !contextInstance || !pageInstance) {
    browserInstance = await chromium.launch({ headless: false });
    contextInstance = await browserInstance.newContext({
      ignoreHTTPSErrors: true,
    });
    pageInstance = await contextInstance.newPage();
  }

  if (!pageInstance) {
    pageInstance = await contextInstance.newPage();
  }

  await pageInstance.goto(url, { waitUntil: "networkidle" });

  const domRepresentation = await pageInstance.evaluate(getDomRepresentation, {
    doHighlightElements: true,
    focusHighlightIndex: -1,
    viewportExpansion: 0,
  });

  return JSON.stringify(domRepresentation, null, 2);
};

export const clickElementByHighlightIndex = async (
  args: string,
): Promise<string> => {
  const highlightIndex = Number(args);

  if (isNaN(highlightIndex)) {
    return `Could not parse highlightIndex from "${args}". Please provide an integer.`;
  }

  if (!pageInstance) {
    return "No Playwright page is open. Please call getInteractiveDomRepresentation first.";
  }

  const selector = `[browser-user-highlight-id="playwright-highlight-${highlightIndex}"]`;

  const elementHandle = await pageInstance.$(selector);
  if (!elementHandle) {
    return `No element found with highlightIndex = ${highlightIndex}`;
  }

  await elementHandle.click();
  return `Clicked element highlightIndex = ${highlightIndex}`;
};

export const closeBrowser = async (): Promise<string> => {
  if (browserInstance) {
    await browserInstance.close();
  }
  browserInstance = null;
  contextInstance = null;
  pageInstance = null;
  return "Browser closed successfully.";
};

async function ensureBrowserPage(): Promise<Page> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
    contextInstance = await browserInstance.newContext();
    pageInstance = await contextInstance.newPage();
  }
  if (!pageInstance) {
    pageInstance = (await contextInstance?.newPage()) ?? null;
  }

  if (!pageInstance) {
    throw new Error("Failed to create a new page in the browser.");
  }

  return pageInstance;
}

export const fillInputByHighlightIndex = async (
  args: string,
): Promise<string> => {
  const [indexStr, ...rest] = args.split("||");
  const highlightIndex = parseInt(indexStr?.trim() ?? "", 10);

  const textToFill = rest.join("||").trim();

  if (isNaN(highlightIndex)) {
    return `Error: Could not parse highlightIndex from "${args}". Expected e.g. "5||Hello world".`;
  }

  if (!textToFill) {
    return `Error: No text to fill was provided. Expected e.g. "5||Hello world".`;
  }

  const page = await ensureBrowserPage();

  const selector = `[browser-user-highlight-id="playwright-highlight-${highlightIndex}"]`;
  const elementHandle = await page.$(selector);
  if (!elementHandle) {
    return `Error: No element found for highlightIndex ${highlightIndex}.`;
  }

  try {
    await elementHandle.fill(textToFill);

    return `Successfully filled element at highlightIndex ${highlightIndex} with text: "${textToFill}".`;
  } catch (err: any) {
    return `Error while filling input: ${err.message}`;
  }
};

export const tools: Record<string, Tool> = {
  calculate: {
    name: "calculate",
    description:
      'Evaluates a mathematical expression. For example, use it like: {"tool": "calculate", "args": "2+2"}',
    func: sumTool,
  },
  getInteractiveDomRepresentation: {
    name: "getInteractiveDomRepresentation",
    description:
      "Retrieves the DOM with highlightIndex for interactive elements.",
    func: getInteractiveDomRepresentation,
  },
  clickElementByHighlightIndex: {
    name: "clickElementByHighlightIndex",
    description:
      "Clicks on a highlighted interactive element by its highlightIndex.",
    func: clickElementByHighlightIndex,
  },
  fillInputByHighlightIndex: {
    name: "fillInputByHighlightIndex",
    description:
      'Fills an input by highlightIndex. Usage: {"tool":"fillInputByHighlightIndex","args":"<index>||<text>"}',
    func: fillInputByHighlightIndex,
  },
  closeBrowser: {
    name: "closeBrowser",
    description: "Closes any open Playwright browser session.",
    func: closeBrowser,
  },
};

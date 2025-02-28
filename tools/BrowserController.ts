import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import getDomRepresentation from "./utils/dom-representation";
import type { DomTree } from "../types";
import { BrowserAction } from "../prompts/ActionRegistry";

export class BrowserAgent {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private domSnapshot: DomTree | null = null;

  public async init(headless: boolean = false): Promise<void> {
    this.browser = await chromium.launch({ headless });
    this.context = await this.browser.newContext({ ignoreHTTPSErrors: true });
    this.page = await this.context.newPage();
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.domSnapshot = null;
  }

  private async goto(url: string): Promise<void> {
    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }
    await this.page.goto(url, { waitUntil: "networkidle" });
  }

  private async updateDomRepresentation(
    doHighlightElements = true,
    focusHighlightIndex = -1,
    viewportExpansion = 0,
  ): Promise<DomTree> {
    this.domSnapshot = null;

    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }

    const dom = (await this.page.evaluate(getDomRepresentation, {
      doHighlightElements,
      focusHighlightIndex,
      viewportExpansion,
    })) as DomTree;

    this.domSnapshot = dom;

    return dom;
  }

  @BrowserAction(
    "visitUrl",
    "Navigate to a specified URL and store the updated DOM internally.",
  )
  public async visitUrl(args: string): Promise<string> {
    const url = args.trim().startsWith("http")
      ? args.trim()
      : "https://" + args.trim();
    await this.goto(url);
    await this.updateDomRepresentation(true, -1, 0);
    return `Visited URL: ${url} and updated DOM snapshot.`;
  }

  @BrowserAction(
    "listClickableElements",
    "Returns a JSON array of { highlightIndex, snippet } for clickable elements. if there is a label nearby, it will be above the current element.",
  )
  public async listClickableElements(_args: string): Promise<string> {
    if (!this.domSnapshot) {
      return "No DOM snapshot available. Use visitUrl first.";
    }

    await this.updateDomRepresentation(true, -1, 0);

    const clickable: Array<{
      highlightIndex: number;
      snippet: string;
      type: string;
    }> = [];

    const walk = (node: any) => {
      if (!node) return;
      if (node.isInteractive && node.highlightIndex >= 0) {
        clickable.push({
          highlightIndex: node.highlightIndex,
          snippet: this.getAllText(node),
          type: node.tagName,
        });
      }
      if (node.children) {
        for (const child of node.children) {
          if (child && typeof child === "object" && "tagName" in child) {
            walk(child);
          }
        }
      }
    };
    walk(this.domSnapshot);

    return JSON.stringify(clickable, null, 2);
  }

  @BrowserAction(
    "getElementDetails",
    "Provide detail about a single element by highlightIndex.",
  )
  public async getElementDetails(args: string): Promise<string> {
    if (!this.domSnapshot)
      return "No DOM snapshot available. Use visitUrl first.";
    const index = parseInt(args.trim(), 10);
    if (isNaN(index)) return `Could not parse highlightIndex from "${args}".`;
    let found: any = null;

    const walk = (node: any) => {
      if (!node) return;

      if (node.highlightIndex === index) {
        found = node;
      }

      if (node.children && !found) {
        for (const c of node.children) {
          if (c && typeof c === "object" && "tagName" in c) {
            walk(c);
            if (found) break;
          }
        }
      }
    };
    walk(this.domSnapshot);

    if (!found) {
      return `No element found with highlightIndex = ${index}`;
    }

    const detail = {
      tagName: found.tagName,
      attributes: found.attributes,
      isVisible: found.isVisible,
      isTopElement: found.isTopElement,
      textNearby: this.getAllText(found).slice(0, 300),
    };
    return JSON.stringify(detail, null, 2);
  }

  @BrowserAction(
    "clickElementByHighlightIndex",
    "Clicks on an element by its highlightIndex in the current DOM",
  )
  public async clickElementByHighlightIndex(args: string): Promise<string> {
    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }

    const highlightIndex = parseInt(args, 10);

    if (isNaN(highlightIndex)) {
      return `Could not parse highlightIndex from "${args}". Must be a number.`;
    }

    const selector = `[browser-user-highlight-id="playwright-highlight-${highlightIndex}"]`;

    const elementHandle = await this.page.$(selector);

    if (!elementHandle) {
      return `Error: No element found with highlightIndex = ${highlightIndex}`;
    }

    await elementHandle.click();

    await this.page.waitForLoadState("networkidle");

    await this.updateDomRepresentation(true, -1, 0);

    return `Clicked element with highlightIndex = ${highlightIndex}.`;
  }

  @BrowserAction(
    "fillInputByHighlightIndex",
    'Fills an input at "highlightIndex" with text. Format: {"tool": "fillInputByHighlightIndex", "args": "<highlightIndex||sometext"}',
  )
  public async fillInputByHighlightIndex(args: string): Promise<string> {
    if (!this.page) throw new Error("No Page found. Did you call init()?");
    const [indexStr, ...rest] = args.split("||");
    const highlightIndex = parseInt(indexStr.trim(), 10);
    const text = rest.join("||").trim();
    if (isNaN(highlightIndex)) {
      return `Could not parse highlightIndex from "${indexStr}". Use "5||Hello world" syntax.`;
    }
    if (!text) {
      return `No text provided. Use "5||Hello world."`;
    }
    const selector = `[browser-user-highlight-id="playwright-highlight-${highlightIndex}"]`;
    const elementHandle = await this.page.$(selector);
    if (!elementHandle)
      return `Error: No element found for highlightIndex ${highlightIndex}`;
    await elementHandle.fill(text);
    await this.updateDomRepresentation();
    return `Filled element at highlightIndex ${highlightIndex} with "${text}"`;
  }

  @BrowserAction("closeBrowser", "Closes the current browser session")
  public async closeBrowser(_args: string): Promise<string> {
    await this.close();
    return "Browser closed successfully.";
  }

  public getDomSnapshot(): DomTree | null {
    return this.domSnapshot;
  }

  private getAllText(node: any): string {
    const collectedTexts: string[] = [];

    function collectText(n: any) {
      if (!n) return;

      if (n.type === "TEXT_NODE" && n.text) {
        collectedTexts.push(n.text);
      }

      if (n.attributes) {
        if (n.attributes.placeholder) {
          collectedTexts.push(n.attributes.placeholder);
        }
        if (n.attributes.alt) {
          collectedTexts.push(n.attributes.alt);
        }
        if (n.attributes.title) {
          collectedTexts.push(n.attributes.title);
        }
        if (n.attributes["aria-label"]) {
          collectedTexts.push(n.attributes["aria-label"]);
        }
        if (n.attributes.value) {
          collectedTexts.push(n.attributes.value);
        }
      }

      if (n.children) {
        for (const child of n.children) {
          collectText(child);
        }
      }
    }

    collectText(node);
    return collectedTexts
      .map((t) => t.trim())
      .filter(Boolean)
      .join(" ");
  }
}

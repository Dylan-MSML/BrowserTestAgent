import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import getDomRepresentation from "./utils/dom-representation";
import type { DomTree, ElementNode, TextNode } from "../types";
import { BrowserAction } from "../prompts/ActionRegistry";
import { Logger } from "./utils/Logger.ts";

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
    "Returns a JSON array of { highlightIndex, snippet } for clickable elements with a screenshot of the page.",
  )
  public async listClickableElements(_args: string): Promise<string> {
    if (!this.domSnapshot) {
      return "No DOM snapshot available. Use visitUrl first.";
    }

    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }

    this.page.waitForLoadState("networkidle");
    this.page.waitForLoadState("load");
    this.page.waitForLoadState("domcontentloaded");
    await this.updateDomRepresentation(true, -1, 0);

    const clickable: Array<{
      highlightIndex: number;
      snippet: string;
      type: string | null;
    }> = [];

    const walk = (node: ElementNode | null) => {
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

    // Take screenshot
    const screenshotBuffer = await this.page.screenshot();
    const base64Image = Buffer.from(screenshotBuffer).toString("base64");

    return JSON.stringify(
      {
        elements: clickable,
        base64Image: base64Image,
        message: "Clickable elements with page screenshot",
      },
      null,
      2,
    );
  }

  @BrowserAction(
    "getElementDetails",
    "Provide detail about a single element by highlightIndex with a screenshot.",
  )
  public async getElementDetails(args: string): Promise<string> {
    if (!this.domSnapshot) {
      return "No DOM snapshot available. Use visitUrl first.";
    }

    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }

    const highlightIndex = parseInt(args.trim(), 10);
    const detail = await this.elementDetailsByHighlightIndex(highlightIndex);

    // Take screenshot with the element highlighted
    await this.updateDomRepresentation(true, highlightIndex, 0);
    const screenshotBuffer = await this.page.screenshot();
    const base64Image = Buffer.from(screenshotBuffer).toString("base64");

    return JSON.stringify(
      {
        element: detail,
        base64Image: base64Image,
        message: `Element details for highlightIndex ${highlightIndex}`,
      },
      null,
      2,
    );
  }

  private async elementDetailsByHighlightIndex(
    highlightIndex: number,
  ): Promise<{
    tagName: string | null;
    attributes: Record<string, string>;
    isVisible: boolean;
    isTopElement: boolean;
    textNearby: string;
  } | null> {
    if (!this.domSnapshot) {
      return null;
    }

    let found: ElementNode | null = null;

    const walk = (node: ElementNode | null) => {
      if (!node) return;

      if (node.highlightIndex === highlightIndex) {
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
      return null;
    }
    found = found as ElementNode;

    const detail = {
      tagName: found.tagName,
      attributes: found.attributes,
      isVisible: found.isVisible,
      isTopElement: found.isTopElement,
      textNearby: this.getAllText(found).slice(0, 300),
    };

    return detail;
  }

  private async getElementHandleByHighlightIndex(highlightIndex: number) {
    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }

    const details = await this.elementDetailsByHighlightIndex(highlightIndex);

    Logger.debug("Element details: ", details);
    if (!details) {
      Logger.debug("No details found for highlightIndex: ", highlightIndex);
      const selector = `browser-user-highlight-id="playwright-highlight-${highlightIndex}"`;
      return this.page.locator(selector).first();
    }
    if (details.tagName === "button") {
      if (details.attributes.role) {
        return this.page
          .getByRole(details.attributes.role, { name: details.textNearby })
          .first();
      }
      return this.page
        .getByRole(details.tagName, { name: details.textNearby })
        .first();
    }

    if (details.tagName === "a") {
      return this.page.getByText(details.textNearby).first();
    }

    if (details.attributes.id) {
      Logger.debug("ID found: ", details.attributes.id);
      return this.page.locator(`#${details.attributes.id}`);
    }

    if (details.attributes.class) {
      Logger.debug("Class found: ", details.attributes.class);
      return this.page.locator(`.${details.attributes.class}`);
    }

    return this.page.locator(
      `#${details.attributes.id ?? details.attributes.class}`,
    );
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

    const elementHandle =
      await this.getElementHandleByHighlightIndex(highlightIndex);

    Logger.debug(
      "=================================================================================================================================================================",
    );
    Logger.debug("Element handle: ", elementHandle);

    Logger.debug(
      "=================================================================================================================================================================",
    );
    if (!elementHandle) {
      return `Error: No element found with highlightIndex = ${highlightIndex}`;
    }

    try {
      await elementHandle.click({ timeout: 5000 });
    } catch (e) {
      Logger.debug(
        `Click intercepted, trying JavaScript click for element ${highlightIndex}`,
      );
      Logger.debug("Error: ", e);
    }
    await this.page.waitForLoadState("networkidle", { timeout: 6000 });

    await this.updateDomRepresentation(true, -1, 0);

    return `Clicked element with highlightIndex = ${highlightIndex}.
        new state: ${this.listClickableElements("")}`;
  }

  @BrowserAction(
    "openDropdown",
    "Opens a dropdown or autocomplete input and updates the DOM snapshot. e.g. openDropdown 5",
  )
  public async openDropdown(args: string): Promise<string> {
    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }

    const highlightIndex = parseInt(args.trim(), 10);

    if (isNaN(highlightIndex)) {
      return `Could not parse highlightIndex from "${args}".`;
    }

    const elementHandle =
      await this.getElementHandleByHighlightIndex(highlightIndex);

    if (!elementHandle) {
      return `Error: No element found with highlightIndex = ${highlightIndex}`;
    }

    await elementHandle.click();
    await this.page.waitForLoadState("networkidle", { timeout: 6000 });

    await this.updateDomRepresentation(true, -1, 0);
    return `Opened dropdown/autocomplete for element with highlightIndex = ${highlightIndex} and updated the DOM snapshot.`;
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

    const elementHandle =
      await this.getElementHandleByHighlightIndex(highlightIndex);

    if (!elementHandle)
      return `Error: No element found for highlightIndex ${highlightIndex}`;

    await elementHandle.fill(text);
    await this.updateDomRepresentation();
    return `Filled element at highlightIndex ${highlightIndex} with "${text}"`;
  }

  // @BrowserAction(
  //   "askForMoreTests",
  //   "Asks the user if they want to continue testing with a new test or exit."
  // )
  public async askForMoreTests(args: string): Promise<string> {
    const prompt =
      args.trim() ||
      "Would you like to continue testing something else? (yes/no)";

    Logger.info("\n[Agent Question]:", prompt);

    // Read user input from command line
    Logger.info("Please provide your response:");
    const userInput = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim().toLowerCase());
      });
    });

    if (
      userInput === "no" ||
      userInput === "n" ||
      userInput === "exit" ||
      userInput === "quit"
    ) {
      return "User wants to end the testing session.";
    } else {
      const followupQuestion = "What would you like to test next?";
      Logger.info("\n[Agent Question]:", followupQuestion);
      Logger.info("Please provide your response:");

      const nextTestInput = await new Promise<string>((resolve) => {
        process.stdin.once("data", (data) => {
          resolve(data.toString().trim());
        });
      });

      return `User wants to continue testing. New test request: ${nextTestInput}`;
    }
  }

  @BrowserAction("closeBrowser", "Closes the current browser session")
  public async closeBrowser(_args: string): Promise<string> {
    await this.close();
    return "Browser closed successfully.";
  }

  public async getCurrentUrl(): Promise<string> {
    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }
    return this.page.url();
  }

  @BrowserAction(
    "askUserInput",
    "Asks the user for input about what to test and how to navigate to it. Should be used at the beginning of testing. Can specify a custom question to ask the user.",
  )
  public async askUserInput(args: string): Promise<string> {
    try {
      const parsedArgs = JSON.parse(args);
      const question =
        parsedArgs.question ||
        "What would you like me to test? Please provide details about what to test and how to reach it.";

      Logger.info("\n[Agent Question]:", question);

      // Read user input from command line
      Logger.info("Please provide your response:");
      const userInput = await new Promise<string>((resolve) => {
        process.stdin.once("data", (data) => {
          resolve(data.toString().trim());
        });
      });

      return `User provided the following information: ${userInput}`;
    } catch (e) {
      // Fallback for string input
      const question =
        args.trim() ||
        "What would you like me to test? Please provide details about what to test and how to reach it.";

      Logger.info("\n[Agent Question]:", question);

      // Read user input from command line
      Logger.info("Please provide your response:");
      const userInput = await new Promise<string>((resolve) => {
        process.stdin.once("data", (data) => {
          resolve(data.toString().trim());
        });
      });

      return `User provided the following information: ${userInput}`;
    }
  }

  @BrowserAction(
    "takeScreenshot",
    "Takes a screenshot of the current page and encodes it as base64 for OpenAI vision.",
  )
  public async takeScreenshot(_args: string): Promise<string> {
    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }

    const screenshotBuffer = await this.page.screenshot();
    const base64Image = Buffer.from(screenshotBuffer).toString("base64");

    return JSON.stringify({
      base64Image: base64Image,
      message: "Screenshot taken successfully.",
    });
  }

  @BrowserAction(
    "analyzeScreenshot",
    "Takes a screenshot and sends it to OpenAI Vision API for analysis.",
  )
  public async analyzeScreenshot(args: string): Promise<string> {
    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }

    Logger.debug("Screenshot args: ", args);
    const prompt =
      args.trim() ||
      "What is shown in this screenshot? if there is text, always extract it. be as comprehensive as possible.";
    const screenshotBuffer = await this.page.screenshot();
    const base64Image = Buffer.from(screenshotBuffer).toString("base64");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY environment variable.");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error calling OpenAI API: ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  @BrowserAction(
    "saveScreenshot",
    "Takes a screenshot and saves it to a file. Format: saveScreenshot filename.png",
  )
  public async saveScreenshot(args: string): Promise<string> {
    if (!this.page) {
      throw new Error("No Page found. Did you call init()?");
    }

    const filename = args.trim() || `screenshot-${Date.now()}.png`;
    const screenshotBuffer = await this.page.screenshot();

    await Bun.write(filename, screenshotBuffer);

    return `Screenshot saved to ${filename}`;
  }

  public static async encodeImageToBase64(filePath: string): Promise<string> {
    const file = Bun.file(filePath);
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");
  }

  private getAllText(node: ElementNode | null): string {
    const collectedTexts: string[] = [];

    function collectText(n: ElementNode | TextNode | null) {
      if (!n) return;

      n = n as TextNode;
      if (n.type === "TEXT_NODE" && n.text) {
        collectedTexts.push(n.text);
      }

      n = n as unknown as ElementNode;
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

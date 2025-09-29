import { BrowserAgent } from "./tools/BrowserController.ts";
import { TestPlanner } from "./tools/TestPlanner.ts";
import { getRegisteredActions } from "./prompts/ActionRegistry.ts";
import { systemPrompt } from "./prompts/prompts.ts";
import type { Message, OpenAIChatRequest, OpenAIResponse } from "./types.ts";
import { Logger } from "./tools/utils/Logger.ts";
import * as readline from "readline";

let OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function promptForApiKey(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Please enter your OpenAI API key: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function ensureApiKey(): Promise<void> {
  if (!OPENAI_API_KEY) {
    console.log("No OpenAI API key found in environment variables.");
    OPENAI_API_KEY = await promptForApiKey();

    if (!OPENAI_API_KEY) {
      throw new Error("OpenAI API key is required to run this application.");
    }

    process.env.OPENAI_API_KEY = OPENAI_API_KEY;
    console.log("API key set successfully!");
  }
}

async function callOpenAI(messages: Message[]): Promise<string> {
  const body: OpenAIChatRequest = {
    model: "gpt-4o",
    messages,
    temperature: 0.7,
    max_tokens: 600,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error("Error calling OpenAI API: " + errorText);
  }

  const data = (await response.json()) as OpenAIResponse;
  const assistantText =
    typeof data.choices[0].message.content === "string"
      ? data.choices[0].message.content
      : JSON.stringify(data.choices[0].message.content);
  return assistantText;
}

function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function parseToolInvocation(message: string): {
  tool: string;
  args: string;
  message?: string;
  bug?: any;
  base64Image?: string;
} | null {
  try {
    const parsed = JSON.parse(message);
    if (
      parsed &&
      typeof parsed.tool === "string" &&
      typeof parsed.arguments === "string"
    ) {
      return {
        tool: parsed.tool,
        args: parsed.arguments,
        message:
          typeof parsed.message === "string" ? parsed.message : undefined,
        bug: parsed.bug || undefined,
        base64Image: parsed.base64Image || undefined,
      };
    }

    if (
      parsed &&
      parsed.base64Image &&
      typeof parsed.base64Image === "string"
    ) {
      return {
        tool: "processScreenshot",
        args: "",
        message: parsed.message || "Screenshot taken successfully.",
        base64Image: parsed.base64Image,
      };
    }
  } catch (err) {
    Logger.error("Failed to parse JSON tool invocation:", err);
  }
  return null;
}

async function main() {
  ensureApiKey();
  const userPrompt = process.argv.slice(2).join(" ");
  const defaultPrompt = "Start web testing";

  Logger.setDebugMode(process.env.DEBUG === "true");

  const agent = new BrowserAgent();
  await agent.init(false);

  const testPlanner = new TestPlanner(agent);

  let messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt || defaultPrompt },
  ];

  let stepCount = 0;
  const maxSteps = 40;

  while (true) {
    stepCount++;

    const response = await callOpenAI(messages);
    Logger.debug("\nLLM Agent response:\n", response);

    const invocation = parseToolInvocation(response);
    Logger.debug("Parsed tool invocation:", invocation);

    if (invocation) {
      const toolDef = getRegisteredActions().find(
        ({ name }) => name === invocation.tool,
      );

      if (!toolDef) {
        Logger.info(`\nUnknown tool: '${invocation.tool}'. No action found.\n`);
        break;
      }

      Logger.debug(
        `Invoking tool '${invocation.tool}' with args: ${invocation.args}`,
      );

      let toolResult: string;
      try {
        toolResult = await toolDef.handler(agent, invocation.args);
      } catch (e: any) {
        toolResult = `Error: ${e.message}`;
      }

      if (invocation.tool === "processScreenshot" && invocation.base64Image) {
        Logger.debug("\nProcessing screenshot...");

        messages.push({
          role: "assistant",
          content: "Taking a screenshot...",
        });

        messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: "I took a screenshot of the current page. What do you see in this image?",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${invocation.base64Image}`,
              },
            },
          ],
        });

        continue;
      }

      if (invocation.bug) {
        Logger.info("\n🐛 BUG REPORT 🐛");
        Logger.info("Severity:", invocation.bug.severity);
        Logger.info("Description:", invocation.bug.description);
        Logger.info("Steps to reproduce:", invocation.bug.steps);
        Logger.info("Expected behavior:", invocation.bug.expected);
        Logger.info("Actual behavior:", invocation.bug.actual);

        messages.push({
          role: "assistant",
          content: response,
          bug: invocation.bug,
        });
      } else {
        messages.push({ role: "assistant", content: response });
      }

      Logger.debug("\nTool result:\n", toolResult);

      let parsedResult: any;
      try {
        parsedResult = JSON.parse(toolResult);
        if (parsedResult.base64Image) {
          Logger.debug(
            "\nDetected base64 image in result, sending to OpenAI Vision API...",
          );

          let textPrompt =
            "Here's a screenshot of the current page. What do you see in this image?";

          if (
            invocation.tool === "listClickableElements" &&
            parsedResult.elements
          ) {
            const clickableElements = parsedResult.elements;
            const elementsJSON = JSON.stringify(clickableElements, null, 2);
            textPrompt = `Here's a screenshot of the current page with clickable elements:\n\n${elementsJSON}\n\nPlease analyze the image and elements to help with navigation.`;
          } else if (
            invocation.tool === "getElementDetails" &&
            parsedResult.element
          ) {
            const elementDetail = parsedResult.element;
            const elementJSON = JSON.stringify(elementDetail, null, 2);
            textPrompt = `Here's a screenshot of the page with element details:\n\n${elementJSON}\n\nPlease analyze this element and provide recommendations.`;
          }

          messages.push({
            role: "user",
            content: [
              {
                type: "text",
                text: textPrompt,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${parsedResult.base64Image}`,
                },
              },
            ],
          });

          continue;
        }
      } catch (e) {}

      messages.push({
        role: "user",
        content: toolResult,
      });
    } else {
      const possibleJson = tryParseJSON(response);
      if (
        possibleJson &&
        possibleJson.reasoning &&
        possibleJson.reasoning.includes("completed")
      ) {
        Logger.info("\nTEST SUMMARY:\n", response);
        continue;
      } else if (response.includes("User wants to end the testing session")) {
        Logger.info("\nFINAL ANSWER:\n", response);
        break;
      } else if (response.includes("User wants to continue testing")) {
        stepCount = 0;
        Logger.info("\nContinuing with new test...\n");
        continue;
      } else {
        Logger.info("\nFINAL ANSWER:\n", response);
        break;
      }
    }

    if (stepCount >= maxSteps) {
      Logger.warn(
        `Reached max steps (${maxSteps}), stopping to prevent infinite loop.`,
      );
      Logger.info(
        "\nWould you like to continue despite reaching the step limit? (yes/no)",
      );

      const userInput = await new Promise<string>((resolve) => {
        process.stdin.once("data", (data) => {
          resolve(data.toString().trim().toLowerCase());
        });
      });

      if (userInput === "yes" || userInput === "y") {
        stepCount = 0;
        continue;
      } else {
        break;
      }
    }
  }

  await agent.close();
}

main().catch((err) => Logger.error("Error in main:", err));

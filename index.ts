import { BrowserAgent } from "./tools/BrowserController.ts";
import { TestPlanner } from "./tools/TestPlanner.ts";
import { getRegisteredActions } from "./prompts/ActionRegistry.ts";
import { systemPrompt } from "./prompts/prompts.ts";
import type { Message, OpenAIChatRequest, OpenAIResponse } from "./types.ts";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  throw new Error(
    "Missing OPENAI_API_KEY env variable. Please set it before running the script.",
  );
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

    // Special case for screenshot results with base64 data
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
    console.error("Failed to parse JSON tool invocation:", err);
  }
  return null;
}

async function main() {
  const userPrompt = process.argv.slice(2).join(" ");
  if (!userPrompt) {
    console.error("Usage: bun run index.ts  -- 'Your question or command'");
    return;
  }

  const agent = new BrowserAgent();
  await agent.init(false);

  const testPlanner = new TestPlanner(agent);

  let messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let stepCount = 0;
  const maxSteps = 40;

  while (true) {
    stepCount++;

    const response = await callOpenAI(messages);
    console.log("\nLLM Agent response:\n", response);

    const invocation = parseToolInvocation(response);
    console.log("Parsed tool invocation:", invocation);

    if (invocation) {
      const toolDef = getRegisteredActions().find(
        ({ name }) => name === invocation.tool,
      );

      if (!toolDef) {
        console.log(`\nUnknown tool: '${invocation.tool}'. No action found.\n`);
        break;
      }

      console.log(
        `Invoking tool '${invocation.tool}' with args: ${invocation.args}`,
      );

      let toolResult: string;
      try {
        toolResult = await toolDef.handler(agent, invocation.args);
      } catch (e: any) {
        toolResult = `Error: ${e.message}`;
      }

      const toolIsDomRepresentation =
        invocation.tool === "getInteractiveDomRepresentation";

      // Handle special case for processScreenshot
      if (invocation.tool === "processScreenshot" && invocation.base64Image) {
        console.log("\nProcessing screenshot...");

        // Push assistant response without the base64 data to avoid bloating the console
        messages.push({
          role: "assistant",
          content: "Taking a screenshot...",
        });

        // Use the base64 image in the next user message to OpenAI
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

      // Handle bug reporting
      if (invocation.bug) {
        console.log("\n🐛 BUG REPORT 🐛");
        console.log("Severity:", invocation.bug.severity);
        console.log("Description:", invocation.bug.description);
        console.log("Steps to reproduce:", invocation.bug.steps);
        console.log("Expected behavior:", invocation.bug.expected);
        console.log("Actual behavior:", invocation.bug.actual);

        // Store bug in messages
        messages.push({
          role: "assistant",
          content: response,
          bug: invocation.bug,
        });
      } else {
        messages.push({ role: "assistant", content: response });
      }

      console.log("\nTool result:\n", toolResult);

      // Check if the result contains a base64 image
      let parsedResult: any;
      try {
        parsedResult = JSON.parse(toolResult);
        if (parsedResult.base64Image) {
          console.log(
            "\nDetected base64 image in result, sending to OpenAI Vision API...",
          );

          // For listClickableElements, we need to preserve the elements data
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
      } catch (e) {
        // Not JSON or doesn't have base64Image, continue as normal
      }

      // Normal flow for other tools
      messages.push({
        role: "user",
        content: toolResult,
        isDomRepresentation: toolIsDomRepresentation ? true : undefined,
      });
    } else {
      console.log("\nFINAL ANSWER:\n", response);
      break;
    }

    if (stepCount >= maxSteps) {
      console.warn(
        `Reached max steps (${maxSteps}), stopping to prevent infinite loop.`,
      );
      break;
    }
  }

  await agent.close();
}

main().catch((err) => console.error("Error in main:", err));

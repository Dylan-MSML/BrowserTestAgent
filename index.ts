import { BrowserAgent } from "./tools/BrowserController.ts";
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
  const assistantText = data.choices[0].message.content;
  return assistantText;
}

function parseToolInvocation(
  message: string,
): { tool: string; args: string; message?: string } | null {
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

      messages.push({ role: "assistant", content: response });
      console.log("\nTool result:\n", toolResult);

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

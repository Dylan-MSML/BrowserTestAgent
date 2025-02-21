import { systemPrompt } from "./prompts/prompts.ts";
import { tools } from "./tools/tools.ts";
import type { Message, OpenAIChatRequest, OpenAIResponse } from "./types.ts";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  throw new Error(
    "Missing OPENAI_API_KEY env variable. Please set it before running the script.",
  );
}

async function callOpenAI(messages: Message[]): Promise<[string, Headers]> {
  const body: OpenAIChatRequest = {
    model: "gpt-4o-mini",
    messages,
    temperature: 0.7,
    max_tokens: 500,
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

  return [data.choices[0].message.content, response.headers];
}

function parseToolInvocation(
  message: string,
): { tool: string; args: string } | null {
  try {
    const parsed = JSON.parse(message);
    return parsed;
  } catch (err) {
    console.error("Failed to parse tool invocation:", err);
  }
  return null;
}

async function main() {
  const userPrompt = process.argv.slice(2).join(" ");

  if (!userPrompt) {
    console.error("Usage: bun run index.ts  -- 'Your question or command'");
    return;
  }

  let messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let stepCount = 0;
  const maxSteps = 20;

  while (true) {
    stepCount++;

    //Sleep for 5 seconds
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const [response, headers] = await callOpenAI(messages);

    // console.log("headers", headers);
    console.log("\nLLM Agent response:\n", response);

    const invocation = parseToolInvocation(response);
    console.log("Parsed tool invocation:", invocation);

    if (invocation && tools[invocation.tool]) {
      console.log(
        `Invoking tool '${invocation.tool}' with args: ${invocation.args}`,
      );

      const toolResult = await tools[invocation.tool].func(invocation.args);

      const toolIsDomRepresentation =
        invocation.tool === "getInteractiveDomRepresentation";

      messages.push({ role: "assistant", content: response });
      console.log("\nTool result:\n", JSON.stringify(toolResult));

      messages.push({
        role: "user",
        content: `${toolResult}`,
        isDomRepresentation: toolIsDomRepresentation ? true : undefined,
      });
    } else {
      console.log("\nFINAL ANSWER:\n", response);
      break;
    }

    if (stepCount >= maxSteps) {
      console.warn(
        `Reached max steps (${maxSteps}), exiting to prevent infinite loop.`,
      );
      break;
    }
  }
}

main();

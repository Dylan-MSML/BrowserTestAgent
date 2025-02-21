import type { BrowserAgent } from "../tools/BrowserController";

/**
 * We define the interface for a "ToolAction" in your system:
 *   name: the tool name the LLM uses (e.g. "clickElementByHighlightIndex")
 *   description: short doc string for the LLM
 *   handler(agent, args): the function to call with your agent instance + raw args
 */
interface ToolAction {
  name: string;
  description: string;
  handler: (agent: BrowserAgent, args: string) => Promise<string>;
}

/**
 * A central registry where we store all actions. The LLM can see them and call them by name.
 */
const actionRegistry = new Map<string, ToolAction>();

/**
 * Decorator that registers an instance method as a "tool" in the global registry.
 * Each decorated method:
 *   - Must be `async method(args: string): Promise<string>`
 *   - Will appear in the registry under the given `name`
 *   - The LLM calls it by returning JSON: {"tool": "<name>", "args": "..."}
 */
export function BrowserAction(name: string, description: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<(args: string) => Promise<string>>,
  ) {
    if (!descriptor.value) {
      throw new Error(
        "Decorator can only be applied to methods with a value()",
      );
    }

    const methodImpl = descriptor.value;
    actionRegistry.set(name, {
      name,
      description,
      handler: async (agent: BrowserAgent, args: string) => {
        // "this" is the agent instance at runtime
        // We'll call the method using the agent as context:
        return methodImpl.call(agent, args);
      },
    });
  };
}

export function getRegisteredActions(): ToolAction[] {
  return [...actionRegistry.values()];
}

import type { BrowserAgent } from "../tools/BrowserController";
interface ToolAction {
  name: string;
  description: string;
  handler: (agent: BrowserAgent, args: string) => Promise<string>;
}

const actionRegistry = new Map<string, ToolAction>();

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
        return methodImpl.call(agent, args);
      },
    });
  };
}

export function getRegisteredActions(): ToolAction[] {
  return [...actionRegistry.values()];
}

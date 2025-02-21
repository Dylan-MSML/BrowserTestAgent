export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
  isDomRepresentation?: boolean;
};

export interface OpenAIChatRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
}

export interface Tool {
  name: string;
  description: string;
  func: (args: string) => Promise<string>;
}

export interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface Point {
  x: number;
  y: number;
}

export interface RectCoordinates {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
  center: Point;
  width: number;
  height: number;
}

export interface Viewport {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

interface TextNode {
  type: "TEXT_NODE";
  text: string;
  isVisible: boolean;
}

export interface ElementNode {
  tagName: string | null;
  attributes: Record<string, string>;
  xpath: string | null;
  children?: Array<ElementNode | TextNode | null>;
  viewportCoordinates: RectCoordinates;
  pageCoordinates: RectCoordinates;
  viewport: Viewport;
  isInteractive: boolean;
  isVisible: boolean;
  isTopElement: boolean;
  highlightIndex: number;
  shadowRoot: boolean;
}

export type DomTree = ElementNode;

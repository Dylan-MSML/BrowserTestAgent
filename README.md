# agentllm

An LLM-powered web testing agent that can autonomously browse and test web applications.

## Installation

To install dependencies:

```bash
bun install
```

## Usage

You can run the agent without any command-line arguments:

```bash
bun run index.ts
```

This will start the agent, which will ask for your testing requirements via the command line.

Alternatively, you can provide an initial prompt:

```bash
bun run index.ts -- 'Test the login form on example.com'
```

To enable debug logs:

```bash
DEBUG=true bun run index.ts
```

## Features

- Interactive browser automation via Playwright
- Automatically detects clickable elements
- Takes screenshots and analyzes page content
- Reports bugs with severity, steps to reproduce, and expected vs. actual behavior
- Interactive user input to guide testing

This project was created using `bun init` in bun v1.2.2. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

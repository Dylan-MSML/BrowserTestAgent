import { BrowserAction } from "../prompts/ActionRegistry";
import { BrowserAgent } from "./BrowserController";

interface TestPlan {
  objective: string;
  testAreas: TestArea[];
  summary: string;
}

interface TestArea {
  name: string;
  description: string;
  testCases: TestCase[];
}

interface TestCase {
  id: string;
  description: string;
  steps: string[];
  expected: string;
}

export class TestPlanner {
  private browserAgent: BrowserAgent;

  constructor(browserAgent: BrowserAgent) {
    this.browserAgent = browserAgent;
  }

  @BrowserAction(
    "createTestPlan",
    "Creates a comprehensive test plan for an application or specific feature. Specify what to test, e.g., 'login form', 'checkout process'.",
  )
  public async createTestPlan(args: string): Promise<string> {
    const testTarget = args.trim();
    if (!testTarget) {
      return "Error: Please specify what to test (e.g., 'login form', 'checkout process').";
    }

    const currentUrl = await this.browserAgent.getCurrentUrl();

    // Generate plan based on test target
    const plan = this.generateTestPlan(testTarget, currentUrl);

    return JSON.stringify(plan, null, 2);
  }

  @BrowserAction(
    "startTest",
    "Begins executing a specific test case from the test plan. Format: 'TestCaseID'",
  )
  public async startTest(args: string): Promise<string> {
    const testCaseId = args.trim();
    if (!testCaseId) {
      return "Error: Please specify a test case ID to start.";
    }

    return `Starting test case ${testCaseId}. Follow each step and report results.`;
  }

  @BrowserAction(
    "reportBug",
    "Reports a bug found during testing. Format: 'severity||description||steps to reproduce||expected behavior||actual behavior'",
  )
  public async reportBug(args: string): Promise<string> {
    const parts = args.split("||");
    if (parts.length < 5) {
      return "Error: Please provide all required information (severity, description, steps, expected behavior, actual behavior).";
    }

    const [severity, description, steps, expected, actual] = parts;

    const bug = {
      severity,
      description,
      steps,
      expected,
      actual,
      url: await this.browserAgent.getCurrentUrl(),
      timestamp: new Date().toISOString(),
    };

    return JSON.stringify(
      {
        message: "Bug reported successfully",
        bug,
      },
      null,
      2,
    );
  }

  @BrowserAction(
    "completeTesting",
    "Completes the current testing session and generates a summary report.",
  )
  public async completeTesting(_args: string): Promise<string> {
    return JSON.stringify(
      {
        message:
          "Testing completed. Generate your final report with findings and conclusions.",
      },
      null,
      2,
    );
  }

  private generateTestPlan(testTarget: string, currentUrl: string): TestPlan {
    // This would ideally be more sophisticated, perhaps using the LLM to generate
    // a custom test plan based on the current page content.
    // For now, we'll provide a template-based approach

    const testAreas: TestArea[] = [];

    // Add functional testing area
    testAreas.push({
      name: "Functionality",
      description: `Test that all ${testTarget} features work as expected`,
      testCases: [
        {
          id: "FUNC-001",
          description: `Test basic ${testTarget} functionality with valid inputs`,
          steps: [
            "Navigate to the feature",
            "Provide valid input data",
            "Submit or activate the feature",
          ],
          expected: "Feature should work as intended",
        },
        {
          id: "FUNC-002",
          description: `Test ${testTarget} functionality with edge cases`,
          steps: [
            "Navigate to the feature",
            "Provide edge case inputs",
            "Submit or activate the feature",
          ],
          expected: "Feature should handle edge cases appropriately",
        },
      ],
    });

    // Add validation testing area
    testAreas.push({
      name: "Input Validation",
      description: `Test how ${testTarget} validates and handles different inputs`,
      testCases: [
        {
          id: "VAL-001",
          description: `Test ${testTarget} with invalid inputs`,
          steps: [
            "Navigate to the feature",
            "Provide invalid input data",
            "Submit or activate the feature",
          ],
          expected:
            "Error messages should be displayed and no invalid data should be processed",
        },
        {
          id: "VAL-002",
          description: `Test ${testTarget} with boundary values`,
          steps: [
            "Navigate to the feature",
            "Provide boundary value inputs",
            "Submit or activate the feature",
          ],
          expected:
            "System should handle boundary values according to requirements",
        },
        {
          id: "VAL-003",
          description: `Test ${testTarget} with special characters and potentially malicious inputs`,
          steps: [
            "Navigate to the feature",
            "Provide inputs with special characters",
            "Submit or activate the feature",
          ],
          expected:
            "System should sanitize and handle special characters appropriately",
        },
      ],
    });

    // Add accessibility testing area
    testAreas.push({
      name: "Accessibility",
      description: `Test that ${testTarget} is accessible to all users`,
      testCases: [
        {
          id: "ACC-001",
          description: `Test ${testTarget} keyboard navigation`,
          steps: [
            "Navigate to the feature",
            "Attempt to use all feature functionality using only keyboard",
            "Check tab order and focus indicators",
          ],
          expected: "All functionality should be accessible via keyboard",
        },
        {
          id: "ACC-002",
          description: `Test ${testTarget} for readable text and proper contrast`,
          steps: [
            "Navigate to the feature",
            "Check text size and contrast",
            "Verify all content is readable",
          ],
          expected: "All text should be readable with adequate contrast",
        },
      ],
    });

    return {
      objective: `Test the ${testTarget} at ${currentUrl} to ensure functionality, usability, and accessibility`,
      testAreas,
      summary: `This test plan covers basic functionality, input validation, and accessibility testing for ${testTarget}. Execute each test case systematically and report any issues.`,
    };
  }
}

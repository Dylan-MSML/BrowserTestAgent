/**
 * Simple logging utility with debug mode toggle
 */
export class Logger {
  private static debugEnabled = false;

  /**
   * Enable or disable debug logging
   */
  static setDebugMode(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Check if debug mode is enabled
   */
  static isDebugEnabled(): boolean {
    return this.debugEnabled;
  }

  /**
   * Log debug message (only when debug mode is enabled)
   */
  static debug(...args: any[]): void {
    if (this.debugEnabled) {
      console.log(...args);
    }
  }

  /**
   * Log info message (always shown)
   */
  static info(...args: any[]): void {
    console.log(...args);
  }

  /**
   * Log warning message
   */
  static warn(...args: any[]): void {
    console.warn(...args);
  }

  /**
   * Log error message
   */
  static error(...args: any[]): void {
    console.error(...args);
  }
}
const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Production-safe logger: silences verbose debug/info logs in production builds
 * to protect low-end mobile frame rates and prevent leaking user identifiers to logcat.
 */
export const logger = {
  debug: (...args: unknown[]): void => {
    if (IS_DEV) {
      console.debug(...args);
    }
  },
  info: (...args: unknown[]): void => {
    if (IS_DEV) {
      console.log(...args);
    }
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  }
};

import { describe, expect, it, vi } from "vitest";
import { ConsoleLogger } from "./console-logger.js";

describe("ConsoleLogger", () => {
  it("logs info messages", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.info("test message", { key: "value" });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("logs warn messages", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.warn("warning");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("logs error messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.error("error");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("logs debug messages", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.debug("debug");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

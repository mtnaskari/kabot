import { describe, expect, it } from "vitest";
import { normalizeOrigin } from "../src/sites";
import { validateMessage } from "../src/validate";

describe("validateMessage", () => {
  it("normalizes line endings and trims", () => {
    const { value, errors } = validateMessage({ name: "  Ali ", email: "A@Example.ORG", message: "a\r\nb\rc" }, { requireEmail: true });
    expect(errors).toEqual({});
    expect(value).toMatchObject({ name: "Ali", email: "a@example.org", message: "a\nb\nc" });
  });

  it("accepts Persian text", () => {
    const { errors } = validateMessage({ name: "متین", message: "سلام، وقت بخیر" }, { requireEmail: false });
    expect(errors).toEqual({});
  });

  it("rejects newlines in names, bidi overrides and too many links", () => {
    expect(validateMessage({ name: "a\nb", message: "hello" }, { requireEmail: false }).errors.name).toBeDefined();
    expect(validateMessage({ message: "x‏y" }, { requireEmail: false }).errors.message).toBeDefined();
    const links = Array.from({ length: 6 }, (_, i) => `https://spam${i}.example`).join(" ");
    expect(validateMessage({ message: links }, { requireEmail: false }).errors.message).toContain("links");
  });

  it("only accepts http(s) page URLs", () => {
    expect(validateMessage({ message: "hello", page: "javascript:alert(1)" }, { requireEmail: false }).errors.page).toBeDefined();
    expect(validateMessage({ message: "hello", page: "https://a.example/x" }, { requireEmail: false }).errors.page).toBeUndefined();
  });
});

describe("normalizeOrigin", () => {
  it("keeps exact origins", () => {
    expect(normalizeOrigin("https://Example.com")).toBe("https://example.com");
    expect(normalizeOrigin("https://example.com/")).toBe("https://example.com");
  });
});

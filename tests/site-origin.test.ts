import { describe, expect, it } from "vitest";
import { resolveSiteOrigin } from "../src/lib/site-origin";

describe("canonical link origin", () => {
  it("requires explicit production configuration", () => {
    expect(() => resolveSiteOrigin(undefined, true)).toThrow();
    expect(resolveSiteOrigin(undefined, false)).toBe("http://localhost:3000");
  });
  it("normalizes valid HTTPS origins", () => {
    expect(resolveSiteOrigin("https://example.com/", true)).toBe("https://example.com");
  });
  it.each(["javascript:alert(1)", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?x=1", "https://example.com/#x", "http://example.com", "http://localhost:3000"])("rejects unsafe production configuration: %s", (url) => {
    expect(() => resolveSiteOrigin(url, true)).toThrow();
  });
});

import { invoiceQuantity } from "../src/lib/schemas";
it("rejects quantities that would round differently when stored in numeric(10,2)", () => {
  expect(invoiceQuantity.safeParse("1.005").success).toBe(false);
  expect(invoiceQuantity.parse("1.25")).toBe(1.25);
  expect(invoiceQuantity.parse("0.29")).toBe(0.29);
});

import { describe, it, expect } from "vitest";
import { isRecord, parseJSONBody, getStringField } from "../backend/validation";

function createRequest(body: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("hello")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("parseJSONBody", () => {
  it("parses valid JSON body", async () => {
    const req = createRequest(JSON.stringify({ key: "value" }));
    const result = await parseJSONBody(req, "zh");
    expect(isRecord(result)).toBe(true);
    if (isRecord(result)) {
      expect(result.key).toBe("value");
    }
  });

  it("returns 400 Response for invalid JSON", async () => {
    const req = createRequest("not json");
    const result = await parseJSONBody(req, "zh");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it("returns 400 Response for JSON array", async () => {
    const req = createRequest("[1, 2, 3]");
    const result = await parseJSONBody(req, "zh");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it("returns 400 Response for JSON null", async () => {
    const req = createRequest("null");
    const result = await parseJSONBody(req, "zh");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it("returns 400 Response for empty body", async () => {
    const req = createRequest("");
    const result = await parseJSONBody(req, "zh");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });
});

describe("getStringField", () => {
  it("extracts string value", () => {
    expect(getStringField({ name: "Alice" }, "name")).toBe("Alice");
  });

  it("returns undefined for missing field", () => {
    expect(getStringField({}, "name")).toBeUndefined();
  });

  it("returns undefined for non-string value", () => {
    expect(getStringField({ count: 42 }, "count")).toBeUndefined();
  });

  it("returns undefined for empty string after trim", () => {
    expect(getStringField({ name: "   " }, "name")).toBeUndefined();
  });

  it("trims whitespace", () => {
    expect(getStringField({ name: "  Alice  " }, "name")).toBe("Alice");
  });
});

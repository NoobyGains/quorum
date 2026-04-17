import { describe, it, expect } from "vitest";
import { GET } from "../app/api/hello/route";

describe("/api/hello", () => {
  it("returns a well-shaped greeting", async () => {
    const res = GET();
    const body = await res.json();
    expect(body).toMatchObject({
      message: expect.any(String),
      shipped_at: expect.any(String),
    });
    expect(body.message).toContain("quorum-for-apps");
    expect(() => new Date(body.shipped_at).toISOString()).not.toThrow();
  });
});

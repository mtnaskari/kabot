import { describe, expect, it } from "vitest";
import * as entry from "../src/index";

describe("worker entry", () => {
  // workerd treats every named export of the main module as a handler and refuses to start otherwise.
  it("exports only the default handler", () => {
    expect(Object.keys(entry)).toEqual(["default"]);
  });
});

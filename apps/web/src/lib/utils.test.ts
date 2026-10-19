import { expect, test } from "vitest";
import { cn } from "./utils";

test("later spacing replaces earlier spacing", () => {
  expect(cn("px-2", "px-4")).toBe("px-4");
});

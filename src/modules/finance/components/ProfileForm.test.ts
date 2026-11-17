import { describe, expect, it } from "vitest";
import { initialsFrom } from "./ProfileForm";

describe("initials from a name", () => {
  it("takes the first and last word, else the first two letters", () => {
    expect(initialsFrom("Nik M")).toBe("NM");
    expect(initialsFrom("Jo Anne Bloggs")).toBe("JB");
    expect(initialsFrom("cher")).toBe("CH");
    expect(initialsFrom("  ")).toBe("");
  });
});

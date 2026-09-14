import { describe, expect, it } from "vitest";
import { driveFileId, outputLinks } from "./drive-links";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("driveFileId", () => {
  it("reads the id from the webViewLink Drive returns for an uploaded file", () => {
    expect(driveFileId(`https://drive.google.com/file/d/${ID}/view?usp=drivesdk`)).toBe(ID);
    expect(driveFileId(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=drivesdk`)).toBe(ID);
  });

  it("reads an id query parameter", () => {
    expect(driveFileId(`https://drive.google.com/uc?export=download&id=${ID}`)).toBe(ID);
  });

  it("does not treat a laptop path or another site as a Drive file", () => {
    expect(driveFileId("I:/Shared drives/Clients/Feldspar Sport/Month-end/FY26/2607/Drafts/pack.xlsx")).toBeNull();
    expect(driveFileId(`https://evil.example.com/file/d/${ID}/view`)).toBeNull();
    expect(driveFileId(`https://drive.google.com.evil.example/file/d/${ID}/view`)).toBeNull();
  });
});

describe("outputLinks", () => {
  it("gives a Drive file an open link and a direct download link", () => {
    const view = `https://drive.google.com/file/d/${ID}/view?usp=drivesdk`;
    expect(outputLinks(view)).toEqual({
      kind: "drive",
      open: view,
      download: `https://drive.google.com/uc?export=download&id=${ID}`,
    });
  });

  it("leaves a laptop path as a path to copy", () => {
    expect(outputLinks("C:/drafts/pack.xlsx")).toEqual({ kind: "path", path: "C:/drafts/pack.xlsx" });
  });
});

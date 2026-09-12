import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getEditorCode,
  getEditorStorageKey,
  readPersistedEditorCode,
  writePersistedEditorCode,
} from "@/lib/editor-storage";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("editor storage", () => {
  it("uses independent deterministic keys for problems and languages", () => {
    expect(getEditorStorageKey("two-sum", "javascript")).not.toBe(
      getEditorStorageKey("two-sum", "python"),
    );
    expect(getEditorStorageKey("two-sum", "javascript")).not.toBe(
      getEditorStorageKey("binary search", "javascript"),
    );
  });

  it("round-trips persisted code and returns null when absent", () => {
    expect(readPersistedEditorCode("two-sum", "javascript")).toBeNull();

    writePersistedEditorCode("two-sum", "javascript", 'console.log("hello")');
    expect(readPersistedEditorCode("two-sum", "javascript")).toBe(
      'console.log("hello")',
    );
    expect(readPersistedEditorCode("two-sum", "python")).toBeNull();
    expect(readPersistedEditorCode("binary-search", "javascript")).toBeNull();
  });

  it("uses starter code when no valid persisted code exists", () => {
    expect(getEditorCode("two-sum", "javascript", "starter()")).toBe(
      "starter()",
    );

    writePersistedEditorCode("two-sum", "javascript", "saved()");
    expect(getEditorCode("two-sum", "javascript", "starter()")).toBe("saved()");
  });

  it("ignores storage failures", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    expect(readPersistedEditorCode("two-sum", "javascript")).toBeNull();
    expect(() =>
      writePersistedEditorCode("two-sum", "javascript", "code"),
    ).not.toThrow();
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });

  it("falls back for unexpected stored values", () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(
      123 as unknown as string,
    );

    expect(readPersistedEditorCode("two-sum", "javascript")).toBeNull();
  });
});

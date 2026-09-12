const STORAGE_PREFIX = "koder:editor";

export function getEditorStorageKey(problemSlug: string, language: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(problemSlug)}:${encodeURIComponent(language)}`;
}

export function readPersistedEditorCode(
  problemSlug: string,
  language: string,
): string | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(
      getEditorStorageKey(problemSlug, language),
    );
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function writePersistedEditorCode(
  problemSlug: string,
  language: string,
  code: string,
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getEditorStorageKey(problemSlug, language),
      code,
    );
  } catch {
    // localStorage is a best-effort cache; editor state remains in React.
  }
}

export function getEditorCode(
  problemSlug: string,
  language: string,
  starterCode: string,
) {
  return readPersistedEditorCode(problemSlug, language) ?? starterCode;
}

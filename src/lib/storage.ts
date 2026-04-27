const codeStorageKey = 'clover-logic-lab:python-source'

export function loadSavedCode(fallback: string): string {
  if (typeof localStorage === 'undefined') {
    return fallback
  }

  return localStorage.getItem(codeStorageKey) || fallback
}

export function saveCode(source: string): void {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.setItem(codeStorageKey, source)
}

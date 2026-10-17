import { useCallback, useState } from 'react';

/**
 * Borradores en memoria mientras la página esté abierta: si se pierde la red o se cambia de
 * pantalla, el formulario conserva lo escrito. No se guarda en el navegador (no sobrevive recargas).
 */
const drafts = new Map<string, unknown>();

export function useDraft<T>(key: string, initial: () => T): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => (drafts.has(key) ? (drafts.get(key) as T) : initial()));

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        drafts.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  const clear = useCallback(() => {
    drafts.delete(key);
    setValue(initial());
  }, [key, initial]);

  return [value, update, clear];
}

export function clearAllDrafts(): void {
  drafts.clear();
}

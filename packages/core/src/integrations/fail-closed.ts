/**
 * Fail-closed wrapper for optional integration adapters (FR-009).
 * Adapter throws are isolated; callers receive fallback and never propagate.
 */
export async function runAdapterSafe<T>(
  _name: string,
  fn: () => T | Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

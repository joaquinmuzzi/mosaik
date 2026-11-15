/** A value fetched once from the API, with its error, as reactive state for a page. */
export function load<T>(fetcher: () => Promise<T>): { data: T | null; error: string | null } {
  const state = $state<{ data: T | null; error: string | null }>({ data: null, error: null });
  fetcher()
    .then((data) => (state.data = data))
    .catch((cause: unknown) => (state.error = cause instanceof Error ? cause.message : String(cause)));
  return state;
}

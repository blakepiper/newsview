import { useMemo, useSyncExternalStore } from "react";
import { pollingQuery } from "../utils/polling";
export function usePollingQuery<T>(url: string, interval: number) {
  const query = useMemo(() => pollingQuery<T>(url, interval), [url, interval]);
  return useSyncExternalStore(query.subscribe, query.getSnapshot);
}

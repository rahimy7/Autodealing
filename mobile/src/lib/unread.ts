// How many chat messages the person hasn't read, for the Chats tab's badge.
import { useSyncExternalStore } from "react";
let count = 0;
const subs = new Set<() => void>();
export const setUnread = (n: number) => {
  if (n === count) return;
  count = n;
  subs.forEach((f) => f());
};
export const useUnread = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => count,
  );

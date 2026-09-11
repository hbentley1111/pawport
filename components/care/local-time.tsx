"use client";
import { useSyncExternalStore } from "react";
import { careDate, careTime } from "@/lib/care/time";
const subscribe = () => () => {};
export function useCareHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
export function useLocalZone() {
  return useSyncExternalStore(
    subscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "UTC",
  );
}
export function useCareClock(initial: number) {
  return useSyncExternalStore(
    (notify) => {
      const timer = setInterval(notify, 60000);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / 60000) * 60000,
    () => initial,
  );
}
export function CareDateTime({ value, zone }: { value: string; zone: string }) {
  return (
    <time dateTime={value}>
      {careDate(value, zone)} · {careTime(value, zone)}
    </time>
  );
}

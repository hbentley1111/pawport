"use client";
import { useLocalZone, CareDateTime } from "@/components/care/local-time";
export function ConnectionTime({ value }: { value: string | null }) {
  const zone = useLocalZone();
  return value ? <CareDateTime value={value} zone={zone} /> : <>Not yet</>;
}

import "server-only";
import type {
  SchedulingSystem,
  SchedulingAdapter,
} from "@/lib/care/scheduling-adapter";
import { MockSchedulingAdapter, assertMockEnabled } from "./mock";
export function schedulingAdapter(
  system: SchedulingSystem,
  connectionId: string,
): SchedulingAdapter {
  if (system !== "mock") throw new Error("Scheduling system not implemented");
  assertMockEnabled();
  return new MockSchedulingAdapter(connectionId);
}

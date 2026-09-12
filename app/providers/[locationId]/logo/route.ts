import { deliverLogo } from "@/lib/business-profiles/logo";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ locationId: string }> },
) {
  return deliverLogo((await params).locationId);
}

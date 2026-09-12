import { deliverLogo } from "@/lib/business-profiles/logo";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return deliverLogo((await params).organizationId, true);
}

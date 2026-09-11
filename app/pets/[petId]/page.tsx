import { PetDashboard } from "@/components/pet-dashboard";
export const dynamic = "force-dynamic";
export default async function PetPage({
  params,
}: {
  params: Promise<{ petId: string }>;
}) {
  return <PetDashboard petId={(await params).petId} />;
}

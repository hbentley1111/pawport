"use client";
import Image from "next/image";
import { useState } from "react";
import { Cat, Dog, PawPrint } from "lucide-react";
import type { Pet } from "@/lib/types";
export function PetAvatar({
  pet,
}: {
  pet: Pick<Pet, "id" | "name" | "species" | "photo_id">;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const Icon =
    pet.species === "Cat" ? Cat : pet.species === "Dog" ? Dog : PawPrint;
  return (
    <div className={`companion-avatar avatar-${pet.species.toLowerCase()}`}>
      {pet.photo_id && failed !== pet.photo_id ? (
        <Image
          unoptimized
          fill
          sizes="240px"
          src={`/pets/${pet.id}/photo?v=${pet.photo_id}`}
          alt={`${pet.name}’s profile photo`}
          onError={() => setFailed(pet.photo_id!)}
        />
      ) : (
        <Icon
          size={60}
          strokeWidth={1.25}
          aria-label={`${pet.species} avatar`}
        />
      )}
    </div>
  );
}

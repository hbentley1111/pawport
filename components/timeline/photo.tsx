"use client";
import Image from "next/image";
import { useState } from "react";
export function JournalPhoto({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return failed === src ? (
    <p className="muted">This private photo is unavailable.</p>
  ) : (
    <div className="journal-photo">
      <Image
        src={src}
        alt={title}
        fill
        unoptimized
        sizes="(max-width: 600px) 90vw, 640px"
        onError={() => setFailed(src)}
      />
    </div>
  );
}

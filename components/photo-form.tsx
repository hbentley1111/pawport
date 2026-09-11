"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { photoSchema } from "@/lib/pets";
import type { ActionState } from "@/lib/types";
export function PhotoForm({ petId }: { petId: string }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        const form = e.currentTarget,
          data = new FormData(form),
          file = data.get("file");
        if (!(file instanceof File)) {
          setState({ error: "Choose a photo." });
          return;
        }
        const valid = photoSchema.safeParse({
          name: file.name,
          type: file.type,
          size: file.size,
        });
        if (!valid.success) {
          setState({ error: valid.error.issues[0].message });
          return;
        }
        setPending(true);
        setState({});
        try {
          const response = await fetch("/pet-photos/upload", {
            method: "POST",
            body: data,
          });
          const result = await response.json();
          setState(result);
          if (response.ok) {
            form.reset();
            router.refresh();
          }
        } catch {
          setState({
            error:
              "Upload interrupted. Refresh to check your photo, then try again.",
          });
        } finally {
          setPending(false);
        }
      }}
    >
      <input type="hidden" name="pet_id" value={petId} />
      <label className="field">
        <span>Profile photo</span>
        <input
          type="file"
          name="file"
          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
          required
          disabled={pending}
        />
      </label>
      <p className="fine-print">
        JPG, JPEG or PNG · Up to 3 MiB. Visible only to your household,
        including after you create a share pass. Your current photo stays in
        place until its replacement is saved.
      </p>
      {state.error && (
        <p className="feedback error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="feedback success" role="status">
          {state.success}
        </p>
      )}
      <button className="button" type="submit" disabled={pending}>
        <Camera size={16} />
        {pending ? "Saving photo…" : "Save photo"}
      </button>
    </form>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { createClient, configured } from "@/lib/supabase/server";
import {
  tokenSchema,
  type InvitationPreview,
} from "@/lib/provider-dashboard/schema";
import { AcceptInvitation } from "@/components/provider-dashboard/forms";
import { Brand } from "@/components/dashboard";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Business invitation | Pawport",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Invitation({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const parsed = tokenSchema.safeParse((await params).token);
  const db = configured() ? await createClient() : null;
  const auth = db ? await db.auth.getUser() : null;
  if (!auth?.data.user || auth.error)
    return (
      <main className="services-page">
        <Brand />
        <section className="business-panel">
          <h1>Business invitation</h1>
          <p>Sign in to accept this Pawport business invitation.</p>
          <Link className="button" href="/login" referrerPolicy="no-referrer">
            Sign in
          </Link>
          <p className="fine-print">
            After signing in, reopen your invitation link. Use the email address
            that received the invitation.
          </p>
        </section>
      </main>
    );
  const result = parsed.success
    ? await db!.rpc("service_provider_invitation_preview", {
        p_token: parsed.data,
      })
    : null;
  return (
    <main className="services-page">
      <Brand />
      {parsed.success && !result?.error && result?.data ? (
        <AcceptInvitation
          token={parsed.data}
          preview={result.data as InvitationPreview}
        />
      ) : (
        <section className="business-panel">
          <h1>Invitation unavailable</h1>
          <p>
            Check that you are signed in with the invited, confirmed email
            address. The invitation may have expired or been revoked.
          </p>
          <Link href="/account" referrerPolicy="no-referrer">
            Your account
          </Link>
        </section>
      )}
    </main>
  );
}

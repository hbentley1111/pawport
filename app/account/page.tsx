import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, UserRound, LockKeyhole, LogOut } from "lucide-react";
import { createClient, configured } from "@/lib/supabase/server";
import { accountProfile } from "@/lib/account";
import { Brand } from "@/components/dashboard";
import { ProfileForm, PasswordForm } from "@/components/account-forms";
import { signOut } from "@/app/actions";
import { Submit } from "@/components/forms";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  if (!configured()) redirect("/login");
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const profile = accountProfile(user.user_metadata);
  return (
    <main className="setup-page account-page">
      <Brand />
      <div className="account-container">
        <Link href="/" className="account-back">
          <ArrowLeft size={15} /> Back to overview
        </Link>
        <div className="account-heading">
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h1>A little space for you.</h1>
          <p className="muted">
            Manage your personal details and keep your account secure.
          </p>
        </div>
        <div className="account-grid">
          <section className="account-card" aria-labelledby="details-title">
            <span className="stat-icon green">
              <UserRound size={22} />
            </span>
            <h2 id="details-title">Account holder</h2>
            <p className="muted">
              These details are private and never appear on a shared pet
              passport.
            </p>
            <ProfileForm
              name={profile.full_name}
              phone={profile.contact_phone}
              email={user.email ?? ""}
            />
          </section>
          <section className="account-card" aria-labelledby="security-title">
            <span className="stat-icon lilac">
              <LockKeyhole size={22} />
            </span>
            <h2 id="security-title">Password & security</h2>
            <p className="muted">
              Confirm your current password to choose a new one.
            </p>
            <PasswordForm />
          </section>
        </div>
        <div className="account-signout">
          <div>
            <h3>All done for now?</h3>
            <p className="muted">Sign out of your Pawport account.</p>
          </div>
          <form action={signOut}>
            <Submit>
              <LogOut size={16} /> Sign out
            </Submit>
          </form>
        </div>
      </div>
    </main>
  );
}

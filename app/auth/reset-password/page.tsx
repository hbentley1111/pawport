import Link from "next/link";
import { Brand } from "@/components/dashboard";
import { PasswordRecoveryForm } from "@/components/password-recovery";
import { recoveryTokenSchema } from "@/lib/password-recovery";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>;
}) {
  const token = recoveryTokenSchema.safeParse((await searchParams).token_hash);
  return (
    <main className="auth-page">
      <div className="auth-story">
        <Brand />
        <div>
          <p className="eyebrow">A LITTLE PEACE OF MIND.</p>
          <h1>
            Welcome back
            <br />
            to your world.
          </h1>
        </div>
      </div>
      <div className="auth-form-area">
        <div className="auth-form-card">
          <h2>Choose a new password.</h2>
          {token.success ? (
            <>
              <p className="muted">
                Use at least 12 characters. Your email link is verified when you
                submit.
              </p>
              <PasswordRecoveryForm token={token.data} />
            </>
          ) : (
            <>
              <p role="alert" className="feedback error">
                This reset link is missing or invalid. Request a new link to
                continue.
              </p>
              <Link className="button" href="/forgot-password">
                Request a reset link
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

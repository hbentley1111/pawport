import { Brand } from "@/components/dashboard";
import { AuthForm } from "@/components/forms";
import { PawPrint, ShieldCheck } from "lucide-react";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mode?: string }>;
}) {
  const { error, mode } = await searchParams;
  return (
    <main className="auth-page">
      <div className="auth-story auth-story-photo">
        <Brand />
        <div>
          <span className="eyebrow">FOR A LIFETIME OF TOGETHER.</span>
          <h1>
            Their whole world.
            <br />A little more cared for.
          </h1>
          <p>
            A private home for your pet’s health records.
            <br />
            Ready for wherever life takes you.
          </p>
          <PawPrint className="auth-paw" size={130} strokeWidth={1} />
        </div>
        <span className="private-label">
          <ShieldCheck size={16} /> Private by default. Shared on your terms.
        </span>
      </div>
      <div className="auth-form-area">
        <div className="auth-form-card">
          <p className="eyebrow">WELCOME TO PAWPORT</p>
          <h2>Good care starts here.</h2>
          <p className="muted">You bring the love. We’ll keep the records.</p>
          {error && (
            <p role="alert" className="feedback error">
              That confirmation link is invalid or expired. Try signing in, or
              create your account again for a new email.
            </p>
          )}
          <AuthForm signInFirst={mode === "signin"} />
        </div>
      </div>
    </main>
  );
}

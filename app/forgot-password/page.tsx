import { Brand } from "@/components/dashboard";
import { PasswordRecoveryForm } from "@/components/password-recovery";
export default function ForgotPassword() {
  return (
    <main className="auth-page">
      <div className="auth-story">
        <Brand />
        <div>
          <p className="eyebrow">LET’S GET YOU BACK HOME.</p>
          <h1>
            A fresh start.
            <br />
            Same little family.
          </h1>
          <p>Reset your password and get back to caring for them.</p>
        </div>
      </div>
      <div className="auth-form-area">
        <div className="auth-form-card">
          <p className="eyebrow">PASSWORD RECOVERY</p>
          <h2>Forgot your password?</h2>
          <p className="muted">
            Enter your account email and we’ll send you a reset link.
          </p>
          <PasswordRecoveryForm />
        </div>
      </div>
    </main>
  );
}

# Password recovery

The login page has a **Forgot password?** link to `/forgot-password`. A member enters an email, receives a recovery link, chooses and confirms a password at `/auth/reset-password`, and returns to the sign-in tab. Passwords use the existing 12–128 character limits.

## Required Supabase setup

No migration or new secret is required. In Supabase **Authentication → Email Templates → Reset Password**, use this link:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}">Reset your password</a>
```

This template setting is required: the default implicit-access-token link is not used by this server-rendered flow. Only change the Reset Password template; leave Confirm Signup unchanged. This follows Supabase's [email template variables](https://supabase.com/docs/guides/auth/auth-email-templates) and [password recovery APIs](https://supabase.com/docs/guides/auth/passwords).

In **Authentication → URL Configuration**, allow the exact reset URL for each intended environment:

- `http://localhost:3001/auth/reset-password` for local development on port 3001.
- `https://YOUR-STAGING-HOST/auth/reset-password` for staging.
- Your exact production HTTPS reset URL when a release is authorized.

Set `NEXT_PUBLIC_APP_URL` to the corresponding origin (for example `http://localhost:3001`) and restart locally. This is already an application setting; it must match the actual port. Configure production SMTP and appropriate Supabase Auth email/recovery rate limits before public use. Nothing in this change sends a test email, changes remote configuration, or resets any real account.

## Security and behavior

The server derives the email destination from trusted app configuration, never a client redirect URL. Supabase rate limits reset requests. The response deliberately does not disclose whether an email belongs to an account, including provider errors. Check SMTP/Auth operational logs for delivery problems without logging passwords or reset tokens.

Viewing the reset page does not consume its single-use token, avoiding accidental consumption by email-link previews. On form submission, the server validates the password and confirmation before verifying the token as `recovery`. A separate Supabase client with persistence/refresh disabled verifies the token and updates that verified account. An existing browser session is never accepted as recovery authorization and is never switched to another account by this flow. The isolated recovery session is signed out afterward. If the provider rejects an update after consuming the token, the user is directed to request a new link.

Passwords and sessions are never returned in action state. Reset pages are dynamic, private/no-store, noindex, and use the existing no-referrer policy. Do not add analytics that record the reset URL/query or form fields. Use Supabase's expiration and single-use protection; no recovery tokens are stored in PetThread tables. Existing signup confirmation and sign-in actions are unchanged.

## Verification

Automated mocked tests cover validation, trusted redirect URLs, correct recovery verification, invalid/expired link rejection, no update before verification, confirmation failure without consuming a token, and clearing isolated sessions. They do not send email or modify real users.

In an isolated staging environment after updating the template:

1. Open Login → Forgot password; submit your test account's email and check the generic confirmation.
2. Open the email link (including in a different browser), enter matching passwords of at least 12 characters, and submit.
3. Sign in using the new password; verify the old password no longer works.
4. Reuse the email link and verify rejection. Test an expired/malformed link and request a fresh one.
5. Check unknown-email handling, password mismatch/length errors, mobile layout, and delivery throttling.
6. While signed into test account A, use account B's reset link. Only B's password may change; the ambient A session must remain untouched.
7. Repeat ordinary signup confirmation and sign-in. Keep the Confirm Signup template unchanged.

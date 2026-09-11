"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="setup-page">
      <div className="setup-card">
        <h1>We couldn’t open that record.</h1>
        <p className="muted">
          Your changes may have been saved. Try again to load the latest
          information.
        </p>
        <button className="button" onClick={reset}>
          Try again
        </button>
        <Link className="text-link" href="/">
          Back to overview
        </Link>
      </div>
    </main>
  );
}

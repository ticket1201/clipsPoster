import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Clips Poster",
  description: "Terms governing the use of Clips Poster.",
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <a className="brand" href="/">CLIPS / POSTER</a>
        <a className="legal-back" href="/">Back to application</a>
      </header>
      <article className="legal-content">
        <p className="section-kicker">LEGAL</p>
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated: September 17, 2026</p>

        <section>
          <h2>1. Service</h2>
          <p>Clips Poster helps authorized creators collect, review, format, and publish short-form video highlights to connected social media accounts.</p>
        </section>
        <section>
          <h2>2. Authorized use</h2>
          <p>You may only connect accounts and process content that you own or are authorized to manage. You are responsible for obtaining all necessary rights and permissions for uploaded or published content.</p>
        </section>
        <section>
          <h2>3. Connected platforms</h2>
          <p>Your use of TikTok, Twitch, Kick, and other connected services remains subject to each platform&apos;s own terms, policies, and technical limitations.</p>
        </section>
        <section>
          <h2>4. Publishing control</h2>
          <p>Clips Poster sends prepared videos only to accounts you explicitly connect and select. Qualifying clips may be encoded and delivered to the connected TikTok inbox automatically; the account owner reviews and completes every final publication in the TikTok app.</p>
        </section>
        <section>
          <h2>5. Availability</h2>
          <p>The service may change, be interrupted, or become unavailable while it is being developed. No guarantee of uninterrupted operation is provided.</p>
        </section>
        <section>
          <h2>6. Account access</h2>
          <p>You may disconnect a connected account at any time. Access may be suspended when necessary to protect users, platforms, or the service.</p>
        </section>
      </article>
    </main>
  );
}

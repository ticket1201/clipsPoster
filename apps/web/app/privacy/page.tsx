import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Clips Poster",
  description: "How Clips Poster handles account and publishing data.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <a className="brand" href="/">CLIPS / POSTER</a>
        <a className="legal-back" href="/">Back to application</a>
      </header>
      <article className="legal-content">
        <p className="section-kicker">LEGAL</p>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: September 17, 2026</p>

        <section>
          <h2>1. Information we process</h2>
          <p>Clips Poster processes identifiers and public profile details for connected accounts, source-channel information, video metadata, publishing selections, and authorization tokens required to provide the service.</p>
        </section>
        <section>
          <h2>2. How information is used</h2>
          <p>Information is used to authenticate connected accounts, display account choices, prepare videos, deliver drafts to connected accounts, report upload status, and maintain service security. Final TikTok publication is completed by the account owner in the TikTok app.</p>
        </section>
        <section>
          <h2>3. Storage and security</h2>
          <p>Authentication credentials and tokens are stored server-side and are not intentionally exposed to browser code. Reasonable technical measures are used to protect stored information.</p>
        </section>
        <section>
          <h2>4. Sharing</h2>
          <p>Information is shared with connected platforms only as required to perform actions you request. Clips Poster does not sell personal information.</p>
        </section>
        <section>
          <h2>5. Retention and deletion</h2>
          <p>Connected-account data is retained while needed to provide the service. You may disconnect an account and request deletion of associated authorization data.</p>
        </section>
        <section>
          <h2>6. Your choices</h2>
          <p>You control which accounts are connected and which source channels publish to them. You may revoke platform authorization through the connected platform&apos;s settings.</p>
        </section>
      </article>
    </main>
  );
}

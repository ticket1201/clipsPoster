import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Clips Poster",
  description: "Create, review, and publish short-form highlights from authorized creator channels.",
};

export default function PublicPage() {
  return (
    <main className="public-page">
      <header className="legal-header">
        <span className="brand">CLIPS / POSTER</span>
        <span className="live-pill"><i /> PRIVATE BETA</span>
      </header>
      <section className="public-hero">
        <p className="section-kicker">CREATOR WORKFLOW</p>
        <h1>Highlights, ready to publish.</h1>
        <p>Create, review, and publish short-form video highlights from channels you are authorized to manage.</p>
      </section>
      <footer className="site-footer">
        <span>CLIPS POSTER</span>
        <nav aria-label="Legal">
          <a href="/terms">Terms of Service</a>
          <a href="/privacy">Privacy Policy</a>
        </nav>
      </footer>
    </main>
  );
}

import { Link } from "react-router-dom";
import { ArrowRight, Gamepad2, Keyboard, Trophy } from "lucide-react";
import SiteHeader from "../components/layout/SiteHeader.jsx";
import PixelRunner from "../components/game/PixelRunner.jsx";
const features = [
  { icon: Gamepad2, title: "One-button chaos", text: "Run automatically. Pick your moment. Clear the next obstacle." },
  { icon: Keyboard, title: "Easy to learn", text: "Space, Arrow Up, click or tap to jump. That's the whole idea." },
  { icon: Trophy, title: "Chase your best", text: "Every run is a fresh chance to beat your personal record." },
];
export default function HomePage() {
  return <main className="site-shell">
    <SiteHeader />
    <section className="hero content-wrap">
      <div className="hero-copy">
        <div className="eyebrow"><span className="status-dot" /> THE LITTLE GAME THAT KEEPS GOING</div>
        <h1>JUST ONE<br /><span>MORE RUN.</span></h1>
        <p className="hero-description">A tiny pixel world. A fast pair of feet. And absolutely no reason to stop now.</p>
        <div className="hero-actions"><Link className="button button-primary" to="/play">Start running <ArrowRight size={18} /></Link><a className="button button-quiet" href="#how-to-play">How to play</a></div>
        <div className="micro-proof"><span className="pixel-star">✦</span> QUICK TO START · HARD TO PUT DOWN</div>
      </div>
      <div className="hero-art" aria-label="Pixel-art runner preview">
        <div className="art-sticker sticker-top">RUN<br />WILD</div><div className="art-sticker sticker-bottom">NO<br />BRAKES!</div>
        <PixelRunner />
        <div className="art-caption"><span className="caption-line" /> ROAD RUNNER / 001</div>
      </div>
    </section>
    <section className="feature-strip content-wrap" id="how-to-play">
      {features.map(({ icon: Icon, title, text }, index) => <article className="feature-card" key={title}>
        <div className="feature-top"><span className="feature-index">0{index + 1}</span><Icon size={21} strokeWidth={2.1} /></div>
        <h2>{title}</h2><p>{text}</p>
      </article>)}
    </section>
    <section className="bottom-cta content-wrap"><div><span className="eyebrow">YOUR NEXT HIGH SCORE IS WAITING</span><h2>Feet ready?</h2></div><Link className="button button-dark" to="/play">Let's go <ArrowRight size={18} /></Link></section>
    <footer className="site-footer content-wrap"><span>ROAD RUNNER <span className="footer-dot">●</span> BUILT FOR THE LOVE OF THE RUN</span><span>PRESS START. KEEP MOVING.</span></footer>
  </main>;
}
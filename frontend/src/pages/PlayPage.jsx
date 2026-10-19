import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import GameCanvas from "../components/game/GameCanvas.jsx";
export default function PlayPage() {
  return <main className="play-page">
    {/* <header className="play-header">
      <Link className="back-link" to="/"><ArrowLeft size={17} /> Back to home</Link>
      <Link className="wordmark" to="/"><span className="wordmark-mark">R</span> ROAD RUNNER</Link>
      <span className="play-header-tag">ENDLESS RUNNER / 001</span>
    </header> */}
    {/* <section className="play-intro"><span className="eyebrow"><span className="status-dot" /> THE ROAD IS YOURS</span><h1>Keep moving.</h1><p>Clear the obstacles. Beat your best. Don't blink.</p></section> */}
    <GameCanvas />
    <footer className="play-footer"><span>MADE OF PIXELS & DETERMINATION</span><span>ESC TO PAUSE · R TO RESTART</span></footer>
  </main>;
}
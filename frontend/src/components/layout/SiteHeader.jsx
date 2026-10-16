import { Link, NavLink } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
export default function SiteHeader() {
  return <header className="site-header content-wrap">
    <Link className="wordmark" to="/" aria-label="Road Runner home"><span className="wordmark-mark">R</span><span>ROAD RUNNER</span></Link>
    <nav className="desktop-nav" aria-label="Main navigation"><a href="#how-to-play">How to play</a><NavLink to="/play" className="nav-play">Play now <ArrowUpRight size={15} /></NavLink></nav>
  </header>;
}
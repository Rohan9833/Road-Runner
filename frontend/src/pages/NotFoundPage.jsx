import { Link } from "react-router-dom";
export default function NotFoundPage() {
  return <main className="not-found"><span className="eyebrow">404 / WRONG TURN</span><h1>Looks like<br />you ran off-road.</h1><Link to="/" className="button button-primary">Back to the start</Link></main>;
}
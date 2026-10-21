import { Link } from "wouter";

export default function NotFound() {
  return <div className="nf">
    <div className="eyebrow">404 · route not found</div>
    <h1 className="display page-title">No report at this address.</h1>
    <div className="toolbar"><Link href="/" className="btn primary" data-testid="link-home">Market detail</Link><Link href="/signal-watchlist" className="btn" data-testid="link-watchlist">Signal watchlist</Link></div>
  </div>;
}

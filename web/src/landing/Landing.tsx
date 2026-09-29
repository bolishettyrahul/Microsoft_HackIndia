import { Link } from "react-router-dom";
import { Aurora, Wordmark } from "../components/brand";

export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <Aurora />
      <Wordmark />
      <h1 className="font-display text-6xl">Switch models. Keep <i className="baton-text pr-1">the thread.</i></h1>
      <Link to="/app" className="baton-gradient rounded-xl px-5 py-3 font-medium text-ink">Start a session</Link>
    </div>
  );
}

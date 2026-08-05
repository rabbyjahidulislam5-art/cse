import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// Router-level "go back" affordance for pages reached from a dashboard tile rather than a
// persistent nav tab (e.g. Ledger, Disputes, Profile, Settings, Payments) — styled to match the
// existing local back button in the auth modal (auth-context.tsx).
export default function BackButton({ fallback = '/', className = '' }: { fallback?: string; className?: string }) {
  const navigate = useNavigate();

  const handleClick = () => {
    // history.state.idx > 0 means there's real in-app history to go back to; a direct URL visit
    // or a fresh tab has no prior entry, so fall back to a fixed route instead of leaving the app.
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(fallback);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Go back"
      className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/60 active:scale-95 transition-all mb-3 ${className}`}
    >
      <ArrowLeft className="w-4.5 h-4.5" />
    </button>
  );
}

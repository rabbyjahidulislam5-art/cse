import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet, Eye, EyeOff, TrendingUp } from 'lucide-react';

interface WalletCardProps {
  balance: number;
}

export default function WalletCard({ balance }: WalletCardProps) {
  const [displayed, setDisplayed] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const duration = 1000;
    const steps = 30;
    const increment = balance / steps;
    let current = 0;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      current = Math.min(current + increment, balance);
      setDisplayed(current);
      if (step >= steps) { setDisplayed(balance); clearInterval(timer); }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [balance]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl p-6 sm:p-7"
      style={{
        background: 'linear-gradient(135deg, hsl(42, 82%, 52%) 0%, hsl(38, 85%, 42%) 50%, hsl(32, 80%, 35%) 100%)',
      }}
    >
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-white/[0.06] -translate-y-1/3 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full bg-white/[0.04] translate-y-1/2 -translate-x-1/4" />
      <div className="absolute top-1/2 right-1/4 w-20 h-20 rounded-full bg-white/[0.03]" />

      {/* Card chip */}
      <div className="absolute top-6 right-6 sm:top-7 sm:right-7">
        <div className="w-10 h-7 rounded-md bg-gradient-to-br from-yellow-200/30 to-yellow-400/10 border border-white/10 flex items-center justify-center">
          <div className="w-6 h-4 rounded-sm border border-white/20" />
        </div>
      </div>

      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="w-4.5 h-4.5 text-primary-foreground/60" />
          <span className="text-sm text-primary-foreground/60 font-medium tracking-wide uppercase text-[11px]">Campus Wallet</span>
        </div>

        <div className="flex items-center gap-3 mb-1">
          <div className="text-3xl sm:text-4xl font-bold text-primary-foreground tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {hidden ? '৳ ••••••' : `৳ ${displayed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <button onClick={() => setHidden(!hidden)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
            {hidden ? <EyeOff className="w-3.5 h-3.5 text-primary-foreground/70" /> : <Eye className="w-3.5 h-3.5 text-primary-foreground/70" />}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3 text-primary-foreground/50" />
          <span className="text-[11px] text-primary-foreground/50 font-medium">Available Balance</span>
        </div>
      </div>
    </motion.div>
  );
}

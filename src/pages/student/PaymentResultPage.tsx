import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Clock, Loader2, Home, RotateCcw, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { validateSSLPayment } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { formatCurrency } from '@/lib/mock-data';

export default function PaymentResultPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, refreshDashboard, setWalletBalance } = useUser();
  const statusParam = searchParams.get('status') || '';
  const ref = searchParams.get('ref') || '';

  const [validating, setValidating] = useState(true);
  const [result, setResult] = useState<{ status: 'valid' | 'failed' | 'pending'; message: string; newBalance?: number } | null>(null);

  useEffect(() => {
    if (!ref || !user) return;
    const stored = localStorage.getItem('ssl_payment');
    let purpose = 'topup';
    let itemId: string | undefined;
    if (stored) {
      try { const parsed = JSON.parse(stored); if (parsed.ref === ref) { purpose = parsed.purpose || 'topup'; itemId = parsed.itemId; } } catch {}
    }
    if (statusParam === 'cancelled') { setResult({ status: 'failed', message: 'Payment was cancelled by user' }); setValidating(false); return; }
    validateSSLPayment({ transactionRef: ref, purpose, itemId })
      .then(res => { setResult(res); if (res.status === 'valid') { if (res.newBalance !== undefined) setWalletBalance(res.newBalance); refreshDashboard(); localStorage.removeItem('ssl_payment'); } })
      .catch(e => setResult({ status: 'failed', message: e.message || 'Validation failed' }))
      .finally(() => setValidating(false));
  }, [ref, user]);

  if (validating) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
        <div className="relative w-20 h-20 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-3 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-3 border-transparent border-t-primary animate-spin" />
          <Receipt className="absolute inset-0 m-auto w-8 h-8 text-primary" />
        </div>
        <h2 className="text-lg font-bold text-foreground mb-2">Verifying Payment</h2>
        <p className="text-sm text-muted-foreground text-center max-w-sm">Confirming your payment. This may take a moment.</p>
        <p className="text-xs text-muted-foreground font-mono mt-4">Ref: {ref}</p>
      </div>
    );
  }

  const configs = {
    valid: { icon: CheckCircle2, gradient: 'gradient-success', color: 'text-white', title: 'Payment Successful!' },
    failed: { icon: XCircle, gradient: 'bg-destructive', color: 'text-white', title: 'Payment Failed' },
    pending: { icon: Clock, gradient: 'bg-[hsl(var(--chart-4))]', color: 'text-primary-foreground', title: 'Payment Pending' },
  };
  const cfg = configs[result?.status || 'pending'];
  const Icon = cfg.icon;

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 py-12">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="relative mb-8"
      >
        {result?.status === 'valid' && <div className="absolute inset-0 rounded-full bg-[hsl(var(--chart-3))]/20 animate-pulse-ring" />}
        <div className={`w-24 h-24 rounded-full ${cfg.gradient} flex items-center justify-center relative`}>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2, type: 'spring' }}>
            <Icon className={`w-12 h-12 ${cfg.color}`} strokeWidth={2.5} />
          </motion.div>
        </div>
      </motion.div>

      <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="text-2xl font-bold text-foreground mb-2 text-center">
        {cfg.title}
      </motion.h2>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-muted-foreground text-center max-w-sm">
        {result?.message}
      </motion.p>

      {result?.newBalance !== undefined && result.status === 'valid' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="mt-4 px-5 py-3 rounded-xl border border-border bg-card">
          <p className="text-xs text-muted-foreground">Updated Wallet Balance</p>
          <p className="text-xl font-bold text-foreground tabular">{formatCurrency(result.newBalance)}</p>
        </motion.div>
      )}

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="text-xs text-muted-foreground font-mono mt-4">
        Ref: {ref}
      </motion.p>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="flex flex-col sm:flex-row gap-3 mt-8">
        {result?.status === 'pending' && (
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RotateCcw className="w-4 h-4 mr-2" /> Refresh Status
          </Button>
        )}
        {result?.status === 'valid' && (
          <Button variant="outline" onClick={() => navigate(`/student/receipt?txId=${ref}`)}>
            <Receipt className="w-4 h-4 mr-2" /> Download Receipt
          </Button>
        )}
        <Button onClick={() => navigate('/student')}><Home className="w-4 h-4 mr-2" /> Go to Dashboard</Button>
      </motion.div>
    </div>
  );
}

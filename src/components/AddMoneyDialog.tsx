import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2, CreditCard, ChevronRight, Shield, ArrowLeft } from 'lucide-react';
import { initSSLPayment } from '@/lib/api';

const quickAmounts = [100, 500, 1000, 2000, 5000, 10000];

interface AddMoneyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (newBalance: number) => void;
}

export default function AddMoneyDialog({ open, onOpenChange, onSuccess }: AddMoneyDialogProps) {
  const [step, setStep] = useState<'amount' | 'confirm'>('amount');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const amt = parseFloat(amount) || 0;

  const handleNext = () => {
    if (!amt || amt < 10) { toast.error('Minimum amount is ৳10'); return; }
    if (amt > 100000) { toast.error('Maximum amount is ৳100,000'); return; }
    setStep('confirm');
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await initSSLPayment({ amount: amt, purpose: 'topup', itemLabel: 'Wallet Top Up' });
      localStorage.setItem('ssl_payment', JSON.stringify({ ref: res.transactionRef, purpose: 'topup', amount: amt }));
      toast.success('Redirecting to payment gateway...');
      onOpenChange(false);
      window.location.href = res.gatewayUrl;
    } catch (e: any) { toast.error(e.message || 'Failed to initiate payment'); }
    finally { setLoading(false); }
  };

  const resetState = () => { setAmount(''); setStep('amount'); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetState(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md glass-strong rounded-2xl p-0 overflow-hidden">
        <div className="h-1 bg-accent">
          <motion.div
            className="h-full gradient-primary"
            animate={{ width: step === 'amount' ? '50%' : '100%' }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <div className="p-6">
          <DialogHeader className="text-left mb-5">
            <div className="flex items-center gap-3">
              {step !== 'amount' && (
                <button onClick={() => setStep('amount')} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
                  <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
              <div>
                <DialogTitle className="text-lg font-bold">
                  {step === 'amount' ? 'Add Money' : 'Confirm Top-up'}
                </DialogTitle>
                <DialogDescription className="text-sm mt-0.5">
                  {step === 'amount' ? 'Choose how much to add' : 'Review and proceed to payment'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <AnimatePresence mode="wait">
            {step === 'amount' && (
              <motion.div key="amount" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-5">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount (৳)</label>
                  <Input type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
                    className="mt-2 text-2xl font-bold h-14 text-center bg-accent/50 border-border/60 focus:border-primary" min={10} max={100000} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {quickAmounts.map((q) => (
                    <button key={q} onClick={() => setAmount(String(q))}
                      className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all active:scale-[0.97] ${
                        amount === String(q)
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/60 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                      }`}>
                      ৳{q.toLocaleString()}
                    </button>
                  ))}
                </div>
                <Button onClick={handleNext} className="w-full h-12 text-sm font-semibold" disabled={!amt || amt < 10}>
                  Continue <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </motion.div>
            )}

            {step === 'confirm' && (
              <motion.div key="confirm" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-5">
                <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-bold text-foreground tabular">৳ {amt.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Method</span>
                    <span className="font-medium text-foreground">SSLCommerz (Cards, bKash, Nagad, Rocket)</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Destination</span>
                    <span className="font-medium text-foreground">Campus Wallet</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-accent/30 p-3 rounded-xl">
                  <Shield className="w-4 h-4 text-primary shrink-0" />
                  <span>You will be redirected to the secure SSLCommerz payment gateway. Supports Visa, Mastercard, bKash, Nagad, Rocket, and bank transfers.</span>
                </div>
                <Button onClick={handleSubmit} disabled={loading} className="w-full h-12 text-sm font-semibold">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CreditCard className="w-4 h-4 mr-2" />}
                  {loading ? 'Redirecting...' : `Proceed to Payment — ৳ ${amt.toLocaleString()}`}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

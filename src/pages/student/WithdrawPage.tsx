import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowUpRight, Wallet, Shield, Phone, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PinDialog from '@/components/PinDialog';
import SuccessScreen from '@/components/SuccessScreen';
import { toast } from 'sonner';
import { withdrawFromWallet } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';

type Step = 'amount' | 'details' | 'review' | 'processing' | 'success';

const PROVIDERS = [
  { id: 'bKash', name: 'bKash', color: 'from-pink-500/20 to-pink-600/10 border-pink-500/30 text-pink-500', logoText: 'bKash' },
  { id: 'Nagad', name: 'Nagad', color: 'from-orange-500/20 to-orange-600/10 border-orange-500/30 text-orange-500', logoText: 'Nagad' },
  { id: 'Rocket', name: 'Rocket', color: 'from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-500', logoText: 'Rocket' },
];

export default function WithdrawPage() {
  const navigate = useNavigate();
  const { user, wallet, refreshDashboard } = useUser();

  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState<string>('');
  const [mobileNumber, setMobileNumber] = useState<string>('');
  const [provider, setProvider] = useState<string>('bKash');
  const [pinOpen, setPinOpen] = useState<false | true>(false);
  const [successData, setSuccessData] = useState<{ reference: string; amount: number; newBalance: number; mobile: string; provider: string } | null>(null);

  const numericAmount = parseFloat(amount) || 0;
  const currentBalance = wallet?.balance || 0;

  const handleNextToDetails = () => {
    if (!numericAmount || numericAmount < 100) {
      toast.error('Minimum withdrawal amount is ৳100.');
      return;
    }
    if (numericAmount > 25000) {
      toast.error('Maximum withdrawal limit per transaction is ৳25,000.');
      return;
    }
    if (numericAmount > currentBalance) {
      toast.error('Insufficient wallet balance.');
      return;
    }
    setStep('details');
  };

  const handleNextToReview = () => {
    const cleanMobile = mobileNumber.trim();
    if (!/^01\d{9}$/.test(cleanMobile)) {
      toast.error('Enter a valid 11-digit Bangladeshi mobile number starting with 01.');
      return;
    }
    setStep('review');
  };

  const handleInitiateWithdrawal = () => {
    setPinOpen(true);
  };

  const executeWithdrawal = async () => {
    setStep('processing');
    try {
      const res = await withdrawFromWallet({
        amount: numericAmount,
        mobileNumber: mobileNumber.trim(),
        provider,
      });

      setSuccessData({
        reference: res.reference,
        amount: numericAmount,
        newBalance: res.newBalance,
        mobile: mobileNumber.trim(),
        provider,
      });
      setStep('success');
      refreshDashboard();
    } catch (err: any) {
      toast.error(err.message || 'Withdrawal request failed');
      setStep('review');
    }
  };

  const resetFlow = () => {
    setStep('amount');
    setAmount('');
    setMobileNumber('');
    setSuccessData(null);
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => (step === 'amount' ? navigate(-1) : resetFlow())}
          className="p-2 rounded-xl hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">Withdraw Funds</h1>
          <p className="text-xs text-muted-foreground">Cash out wallet balance to Mobile Banking</p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {step === 'amount' && (
          <FadeIn key="amount" className="space-y-6">
            {/* Wallet Balance Card */}
            <div className="p-4 rounded-2xl bg-card border border-border/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-medium">Available Balance</div>
                  <div className="text-lg font-bold text-foreground">{formatCurrency(currentBalance)}</div>
                </div>
              </div>
            </div>

            {/* Input */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Withdrawal Amount (৳)
              </Label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-primary">৳</span>
                <Input
                  type="number"
                  min={100}
                  max={25000}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="pl-10 text-2xl font-bold tracking-tight h-14 rounded-2xl bg-card border-border/60 focus:border-primary"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>Min: ৳100</span>
                <span>Max: ৳25,000</span>
              </div>
            </div>

            <Button
              onClick={handleNextToDetails}
              disabled={!numericAmount || numericAmount < 100 || numericAmount > currentBalance}
              className="w-full h-12 rounded-xl text-base font-semibold gap-2"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </Button>
          </FadeIn>
        )}

        {step === 'details' && (
          <FadeIn key="details" className="space-y-6">
            {/* Provider selector */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Select Provider
              </Label>
              <div className="grid grid-cols-3 gap-3">
                {PROVIDERS.map((p) => {
                  const isSelected = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProvider(p.id)}
                      className={`p-3.5 rounded-2xl border flex flex-col items-center gap-2 transition-all ${
                        isSelected
                          ? `bg-gradient-to-br ${p.color} border-2 font-bold scale-[1.02]`
                          : 'bg-card border-border/60 hover:border-primary/40 text-muted-foreground'
                      }`}
                    >
                      <span className="text-sm font-bold text-foreground">{p.logoText}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mobile Number Input */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                {provider} Mobile Number
              </Label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="tel"
                  maxLength={11}
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  placeholder="01700000000"
                  className="pl-11 h-12 rounded-xl bg-card border-border/60 focus:border-primary font-mono text-base"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Enter 11-digit personal MFS account number.</p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('amount')} className="w-1/3 h-12 rounded-xl">
                Back
              </Button>
              <Button onClick={handleNextToReview} className="w-2/3 h-12 rounded-xl text-base font-semibold gap-2">
                Review Request
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </FadeIn>
        )}

        {step === 'review' && (
          <FadeIn key="review" className="space-y-6">
            <div className="p-5 rounded-2xl border border-border/60 bg-card space-y-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" /> Review Withdrawal
              </h3>

              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-bold text-foreground text-lg">{formatCurrency(numericAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Provider</span>
                  <span className="font-medium text-foreground">{provider}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Account Number</span>
                  <span className="font-mono font-medium text-foreground">{mobileNumber}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border/40 text-xs">
                  <span className="text-muted-foreground">Remaining Balance</span>
                  <span className="font-semibold text-foreground">{formatCurrency(currentBalance - numericAmount)}</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-accent/40 border border-border/60 flex items-start gap-2.5 text-xs text-muted-foreground">
              <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>Withdrawals are processed manually by Admin Office within 24 hours. Your balance is reserved immediately.</span>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('details')} className="w-1/3 h-12 rounded-xl">
                Back
              </Button>
              <Button onClick={handleInitiateWithdrawal} className="w-2/3 h-12 rounded-xl text-base font-semibold gap-2">
                Confirm & Withdraw
                <ArrowUpRight className="w-4 h-4" />
              </Button>
            </div>
          </FadeIn>
        )}

        {step === 'processing' && (
          <FadeIn key="processing" className="text-center py-12 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto animate-pulse">
              <Wallet className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Processing Withdrawal Request...</h2>
            <p className="text-xs text-muted-foreground">Please wait while we record your transaction securely.</p>
          </FadeIn>
        )}

        {step === 'success' && successData && (
          <SuccessScreen
            key="success"
            title="Withdrawal Requested!"
            subtitle={`Your request to cash out ৳${successData.amount.toLocaleString()} to ${successData.provider} (${successData.mobile}) was submitted successfully.`}
            details={[
              { label: 'Reference', value: successData.reference },
              { label: 'Amount', value: formatCurrency(successData.amount) },
              { label: 'Provider', value: successData.provider },
              { label: 'Mobile Number', value: successData.mobile },
              { label: 'New Balance', value: formatCurrency(successData.newBalance) },
              { label: 'Status', value: 'Pending Admin Approval' },
            ]}
            actions={[
              { label: 'Return to Home', onClick: () => navigate('/student') }
            ]}
          />
        )}
      </AnimatePresence>

      <PinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        mode="verify"
        verifyLength={user?.pinLength || 4}
        onSuccess={executeWithdrawal}
        title="Enter PIN to Authorize Withdrawal"
        description={`Confirm your wallet PIN to authorize ৳${numericAmount.toLocaleString()} withdrawal to ${provider}.`}
      />
    </div>
  );
}

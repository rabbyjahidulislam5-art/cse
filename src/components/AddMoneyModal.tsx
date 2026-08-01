import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wallet, CreditCard, ShieldCheck, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { initWalletTopUp, PIN_REQUIRED_THRESHOLD, OTP_REQUIRED_THRESHOLD } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import PinDialog from '@/components/PinDialog';
import OtpDialog from '@/components/OtpDialog';
import { useUser } from '@/lib/user-context';
import { redirectToPaymentGateway } from '@/lib/payment-redirect';

interface AddMoneyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESETS = [500, 1000, 2000, 5000];

export default function AddMoneyModal({ open, onOpenChange }: AddMoneyModalProps) {
  const { user } = useUser();
  const [step, setStep] = useState<'amount' | 'confirmation'>('amount');
  const [amount, setAmount] = useState<string>('1000');
  const [loading, setLoading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [validatedOtpId, setValidatedOtpId] = useState<string | undefined>(undefined);

  const numericAmount = parseFloat(amount) || 0;

  const handlePresetSelect = (val: number) => {
    setAmount(val.toString());
  };

  const handleToConfirmation = () => {
    if (!numericAmount || numericAmount < 50) {
      toast.error('Minimum top-up amount is ৳50.');
      return;
    }
    if (numericAmount > 50000) {
      toast.error('Maximum top-up amount is ৳50,000.');
      return;
    }
    setStep('confirmation');
  };

  const handleStartAuth = () => {
    // Sequence: Confirmation -> Wallet PIN -> Email OTP
    setPinOpen(true);
  };

  const onPinSuccess = () => {
    // Wallet PIN verified -> Automatically request and enter Email OTP
    setOtpOpen(true);
  };

  const onOtpVerified = (otpId: string) => {
    setValidatedOtpId(otpId);
    executeTopUp(otpId);
  };

  const executeTopUp = async (otpId?: string) => {
    setLoading(true);
    try {
      const res = await initWalletTopUp({ amount: numericAmount, otpId: otpId || validatedOtpId });
      toast.success('Redirecting to payment gateway...');
      redirectToPaymentGateway(res.gatewayUrl, res.transactionRef, () => {
        toast.error('Could not open the payment gateway. Please try again.');
        setLoading(false);
      });
    } catch (err: any) {
      if (err.requiresPin) {
        setPinOpen(true);
      } else if (err.requiresOtp) {
        setOtpOpen(true);
      } else {
        toast.error(err.message || 'Failed to initiate payment');
      }
      setLoading(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!loading) {
      if (!v) setStep('amount');
      onOpenChange(v);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md glass-strong rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-foreground">
              <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center text-primary">
                <Wallet className="w-5 h-5" />
              </div>
              {step === 'amount' ? 'Top-Up Wallet Balance' : 'Payment Summary & Confirmation'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              {step === 'amount'
                ? ''
                : 'Review your top-up details before proceeding'}
            </DialogDescription>
          </DialogHeader>

          {step === 'amount' && (
            <div className="space-y-4 my-2">
              {/* Amount Input */}
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Enter Amount (৳)
                </Label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-primary">৳</span>
                  <Input
                    type="number"
                    min={50}
                    max={50000}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 1000"
                    className="pl-9 text-xl font-bold tracking-tight h-12 rounded-xl bg-card border-border/60 focus:border-primary"
                    disabled={loading}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5 flex justify-between">
                  <span>Min: ৳50</span>
                  <span>Max: ৳50,000</span>
                </p>
              </div>

              {/* Quick Presets */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">Quick Amounts</Label>
                <div className="grid grid-cols-4 gap-2">
                  {PRESETS.map((preset) => {
                    const isSelected = numericAmount === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handlePresetSelect(preset)}
                        disabled={loading}
                        className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]'
                            : 'bg-card border-border/60 hover:border-primary/40 text-foreground'
                        }`}
                      >
                        +{formatCurrency(preset)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Payment Method Banner */}
              <div className="p-3.5 rounded-xl bg-accent/40 border border-border/60 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <CreditCard className="w-4 h-4 text-primary" />
                  <span>Secure Payment</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Supports bKash, Nagad, Rocket, Visa, Mastercard, AMEX & all major BD banks.
                </p>
              </div>
            </div>
          )}

          {step === 'confirmation' && (
            <div className="space-y-4 my-2">
              <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Account Holder</span>
                  <span className="font-semibold text-foreground">{user?.fullName || 'Student'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Student ID</span>
                  <span className="font-medium text-foreground">{user?.studentId || '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Top-Up Amount</span>
                  <span className="font-bold text-foreground tabular text-base">{formatCurrency(numericAmount)}</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {step === 'confirmation' ? (
              <>
                <Button variant="outline" onClick={() => setStep('amount')} disabled={loading} className="rounded-xl">
                  Back
                </Button>
                <Button onClick={handleStartAuth} disabled={loading} className="rounded-xl font-semibold gap-2">
                  Proceed to Verify PIN <ArrowRight className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => handleClose(false)} disabled={loading} className="rounded-xl">
                  Cancel
                </Button>
                <Button
                  onClick={handleToConfirmation}
                  disabled={loading || !numericAmount || numericAmount < 50}
                  className="rounded-xl font-semibold gap-2"
                >
                  Continue to Summary
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auth Modals */}
      <PinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        mode="verify"
        verifyLength={user?.pinLength || 4}
        onSuccess={onPinSuccess}
        title="Verify PIN to Top-Up"
        description={`Confirm your wallet PIN to proceed with ৳${numericAmount.toLocaleString()} top-up.`}
      />

      <OtpDialog
        open={otpOpen}
        onOpenChange={setOtpOpen}
        purpose="Large Payment"
        onSuccess={onOtpVerified}
      />
    </>
  );
}

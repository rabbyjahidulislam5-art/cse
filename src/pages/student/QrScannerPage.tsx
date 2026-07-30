import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ScanLine, Store, BookOpen, CreditCard, Clock, Loader2, Shield, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import BarcodeScanner from '@/components/BarcodeScanner';
import SuccessScreen from '@/components/SuccessScreen';
import PinDialog from '@/components/PinDialog';
import OtpDialog from '@/components/OtpDialog';
import PaymentConfirmModal from '@/components/PaymentConfirmModal';
import PaymentCategoryModal from '@/components/PaymentCategoryModal';
import { toast } from 'sonner';
import {
  validateQrMerchant, payShop, initSSLPayment, PIN_REQUIRED_THRESHOLD, OTP_REQUIRED_THRESHOLD,
  validateLibraryQr, createLibraryQrPayment, validateAccountsQr,
  type ValidateQrMerchantOutputType, type ValidateLibraryQrOutputType,
} from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';

type ShopInfo = NonNullable<ValidateQrMerchantOutputType['shop']>;
type LibraryInfo = NonNullable<ValidateLibraryQrOutputType['library']>;
type Entity = 'shop' | 'library' | 'accounts';
type Step = 'scan' | 'validating' | 'merchant' | 'amount' | 'method' | 'processing' | 'success' | 'error' | 'category';

// Single scan entry point for Shop, Library, and Accounts Office QR codes — a student doesn't
// know in advance which kind of QR they're pointing at. The Shop code path below (validate →
// shop_payment → payShop/initSSLPayment) is unchanged from before; the Library branch is
// additive. Accounts Office QR doesn't lead to one flat payment like Shop/Library — it opens the
// payment-category chooser (all the student's unpaid dues) instead of the merchant/amount steps.
export default function QrScannerPage() {
  const navigate = useNavigate();
  const { user, refreshDashboard } = useUser();
  const [step, setStep] = useState<Step>('scan');
  const [entity, setEntity] = useState<Entity>('shop');
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [library, setLibrary] = useState<LibraryInfo | null>(null);
  const [amount, setAmount] = useState('');
  const [payMode, setPayMode] = useState<'ssl' | 'later'>('ssl');
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);

  const amt = parseFloat(amount) || 0;
  const receiverName = entity === 'library' ? library?.name : shop?.name;

  const handleScan = async (value: string) => {
    setStep('validating');
    try {
      if (value.includes(':ACCOUNTS:')) {
        const res = await validateAccountsQr({ qrData: value });
        if (res.valid) { setEntity('accounts'); setStep('category'); }
        else { setError(res.message || 'Invalid QR code'); setStep('error'); }
        return;
      }
      if (value.includes(':LIBRARY:')) {
        const res = await validateLibraryQr({ qrData: value });
        if (res.valid && res.library) { setEntity('library'); setLibrary(res.library); setStep('merchant'); }
        else { setError(res.message || 'Invalid QR code'); setStep('error'); }
        return;
      }
      const res = await validateQrMerchant({ qrData: value });
      if (res.valid && res.shop) { setEntity('shop'); setShop(res.shop); setStep('merchant'); }
      else { setError(res.message || 'Invalid QR code'); setStep('error'); }
    } catch (e: any) { setError(e.message || 'Failed to validate'); setStep('error'); }
  };

  const handleProceedToAmount = () => setStep('amount');
  const handleProceedToMethod = () => {
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setStep('method');
  };
  const handleProceedToConfirm = () => setConfirmOpen(true);

  const executePayLater = async () => {
    if (!shop) return;
    setStep('processing');
    try {
      await payShop({ shopId: shop.id, shopName: shop.name, amount: amt });
      setStep('success');
      refreshDashboard();
    } catch (e: any) { toast.error(e.message || 'Failed to create due'); setStep('method'); }
  };

  const handleSSLPay = async (otpId?: string) => {
    if (entity === 'library') {
      if (!library) return;
      setStep('processing');
      try {
        const { fineId } = await createLibraryQrPayment({ amount: amt });
        const res = await initSSLPayment({ items: [{ id: fineId, source: 'library', amount: amt, label: 'Library Payment' }], purpose: 'library_fine', itemLabel: 'Library Payment', otpId });
        localStorage.setItem('ssl_payment', JSON.stringify({ ref: res.transactionRef }));
        window.location.href = res.gatewayUrl;
      } catch (e: any) {
        if (e.requiresPin) setPinOpen(true);
        else if (e.requiresOtp) setOtpOpen(true);
        else toast.error(e.message || 'Payment gateway failed');
        setStep('method');
      }
      return;
    }

    if (!shop) return;
    setStep('processing');
    try {
      const res = await initSSLPayment({ items: [{ id: shop.id, source: 'shop', amount: amt, label: shop.name }], purpose: 'shop_payment', itemLabel: shop.name, otpId });
      localStorage.setItem('ssl_payment', JSON.stringify({ ref: res.transactionRef }));
      window.location.href = res.gatewayUrl;
    } catch (e: any) {
      if (e.requiresPin) setPinOpen(true);
      else if (e.requiresOtp) setOtpOpen(true);
      else toast.error(e.message || 'Payment gateway failed');
      setStep('method');
    }
  };

  const proceedToPay = (otpId?: string) => {
    if (payMode === 'later') { executePayLater(); return; }
    handleSSLPay(otpId);
  };

  const onConfirmed = () => {
    setConfirmOpen(false);
    if (payMode === 'later') { proceedToPay(); return; }
    if (amt >= PIN_REQUIRED_THRESHOLD) { setPinOpen(true); return; }
    proceedToPay();
  };

  const onPinVerified = () => {
    if (amt >= OTP_REQUIRED_THRESHOLD) { setOtpOpen(true); return; }
    proceedToPay();
  };

  const onOtpVerified = (otpId: string) => proceedToPay(otpId);

  const reset = () => { setStep('scan'); setEntity('shop'); setShop(null); setLibrary(null); setAmount(''); setPayMode('ssl'); setError(''); };

  const stepIndex = ['scan','validating','merchant','amount','method','processing','success','error'].indexOf(step);
  const progress = step === 'success' ? 100 : step === 'error' ? 0 : Math.min((stepIndex / 5) * 100, 100);

  // Library fines aren't merchant credit — no Pay Later option for a Library QR payment.
  const methods = entity === 'library'
    ? [{ key: 'ssl' as const, label: 'Online Payment', icon: CreditCard, desc: 'Cards, bKash, Nagad, Rocket' }]
    : [
        { key: 'ssl' as const, label: 'Online Payment', icon: CreditCard, desc: 'Cards, bKash, Nagad, Rocket' },
        { key: 'later' as const, label: 'Pay Later', icon: Clock, desc: '7-day payment deadline' },
      ];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => step === 'scan' ? navigate(-1) : reset()} className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">QR Payment</h1>
          <p className="text-xs text-muted-foreground">Scan a Shop, Library, or Accounts Office QR code to pay</p>
        </div>
      </div>

      {/* Progress */}
      {!['scan','error','success','category'].includes(step) && (
        <div className="h-1 bg-accent rounded-full mb-6 overflow-hidden">
          <motion.div className="h-full gradient-primary rounded-full" animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* SCAN */}
        {step === 'scan' && (
          <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="rounded-2xl overflow-hidden border border-border/60">
              <BarcodeScanner onScan={handleScan} formats={['qr_code']} confirmations={2} />
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">Point your camera at a Shop or Library QR code</p>
          </motion.div>
        )}

        {/* VALIDATING */}
        {step === 'validating' && (
          <motion.div key="val" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-sm text-muted-foreground font-medium">Validating...</p>
          </motion.div>
        )}

        {/* MERCHANT / LIBRARY DETAILS */}
        {step === 'merchant' && (shop || library) && (
          <FadeIn key="merchant">
            <div className="rounded-2xl border border-border/60 bg-card p-6 text-center mb-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                {entity === 'library' ? <BookOpen className="w-8 h-8 text-primary" /> : <Store className="w-8 h-8 text-primary" />}
              </div>
              <h2 className="text-xl font-bold text-foreground">{receiverName}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {entity === 'library' ? library?.location : `${shop?.category} · ${shop?.location}`}
              </p>
              <div className="flex items-center justify-center gap-1.5 mt-3">
                <Shield className="w-3.5 h-3.5 text-[hsl(var(--chart-3))]" />
                <span className="text-xs text-[hsl(var(--chart-3))] font-medium">{entity === 'library' ? 'Verified Library' : 'Verified Merchant'}</span>
              </div>
            </div>
            <Button onClick={handleProceedToAmount} className="w-full h-12 font-semibold">
              Continue to Payment <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </FadeIn>
        )}

        {/* AMOUNT */}
        {step === 'amount' && (
          <FadeIn key="amount">
            <div className="space-y-5">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-1">Paying to</p>
                <p className="font-bold text-foreground">{receiverName}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount (৳)</label>
                <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}
                  className="mt-2 text-2xl font-bold h-14 text-center bg-accent/50 border-border/60" min={1} autoFocus />
              </div>
              <Button onClick={handleProceedToMethod} className="w-full h-12 font-semibold" disabled={!amt || amt <= 0}>
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </FadeIn>
        )}

        {/* METHOD */}
        {step === 'method' && (
          <FadeIn key="method">
            <div className="space-y-4">
              <div className="text-center py-2">
                <span className="text-3xl font-bold text-foreground tabular">{formatCurrency(amt)}</span>
                <p className="text-sm text-muted-foreground mt-1">to {receiverName}</p>
              </div>
              {methods.map((m) => (
                <button key={m.key} onClick={() => setPayMode(m.key)}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-all flex items-center gap-4 ${
                    payMode === m.key ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-muted-foreground/30'
                  }`}>
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${payMode === m.key ? 'bg-primary/15' : 'bg-accent'}`}>
                    <m.icon className={`w-5 h-5 ${payMode === m.key ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1">
                    <span className={`font-semibold text-sm ${payMode === m.key ? 'text-primary' : 'text-foreground'}`}>{m.label}</span>
                    <span className="text-xs text-muted-foreground block">{m.desc}</span>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${payMode === m.key ? 'border-primary' : 'border-border'}`}>
                    {payMode === m.key && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                  </div>
                </button>
              ))}
              <Button onClick={handleProceedToConfirm} className="w-full h-12 font-semibold">
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </FadeIn>
        )}

        {/* PROCESSING */}
        {step === 'processing' && (
          <motion.div key="proc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
            <div className="relative w-16 h-16 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
              <CreditCard className="absolute inset-0 m-auto w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Processing Payment...</p>
            <p className="text-xs text-muted-foreground mt-1">Please wait, do not close this page</p>
          </motion.div>
        )}

        {/* SUCCESS */}
        {step === 'success' && (
          <SuccessScreen
            title="Payment Successful!"
            subtitle={`${formatCurrency(amt)} ${payMode === 'later' ? 'due created for' : 'paid to'} ${receiverName}`}
            details={[
              { label: entity === 'library' ? 'Library' : 'Merchant', value: receiverName || '' },
              { label: 'Amount', value: formatCurrency(amt) },
              { label: 'Method', value: payMode === 'ssl' ? 'Online Payment' : 'Pay Later' },
            ]}
            actions={[
              { label: 'Scan Again', onClick: reset, variant: 'outline' },
              { label: 'Done', onClick: () => navigate('/student') },
            ]}
          />
        )}

        {/* ERROR */}
        {step === 'error' && (
          <FadeIn key="error">
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                <ScanLine className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-lg font-bold text-foreground mb-2">Invalid QR Code</h2>
              <p className="text-sm text-muted-foreground mb-6">{error}</p>
              <Button onClick={reset}><ScanLine className="w-4 h-4 mr-2" /> Scan Again</Button>
            </div>
          </FadeIn>
        )}
      </AnimatePresence>

      {(shop || library) && (
        <PaymentConfirmModal
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          receiverName={receiverName || ''}
          receiverRole={entity === 'library' ? 'Library' : 'Shop'}
          payerName={user?.fullName}
          amount={amt}
          method={payMode === 'ssl' ? 'Online Payment (SSLCommerz)' : 'Pay Later (7-day due)'}
          confirmLabel={payMode === 'ssl' ? 'Proceed to Payment' : 'Create Due'}
          onConfirm={onConfirmed}
        />
      )}
      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode="verify" verifyLength={user?.pinLength || 4} onSuccess={onPinVerified} />
      <OtpDialog open={otpOpen} onOpenChange={setOtpOpen} purpose="Large Payment" onSuccess={onOtpVerified} />
      <PaymentCategoryModal open={step === 'category'} onOpenChange={(o) => !o && reset()} />
    </div>
  );
}

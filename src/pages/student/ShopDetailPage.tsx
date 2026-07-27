import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Star, Store, QrCode, CreditCard, Clock, Loader2, Wallet, ChevronRight, Shield, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import PinDialog from '@/components/PinDialog';
import SuccessScreen from '@/components/SuccessScreen';
import { toast } from 'sonner';
import { getShopDetail, payShop, initSSLPayment, type GetShopDetailOutputType } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { CATEGORY_LABELS, formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';

type ShopData = NonNullable<GetShopDetailOutputType['shop']>;
type PayStep = 'idle' | 'amount' | 'method' | 'confirm' | 'processing' | 'success';

export default function ShopDetailPage() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { wallet, refreshDashboard } = useUser();
  const [shop, setShop] = useState<ShopData | null>(null);
  const [loading, setLoading] = useState(true);
  const [payStep, setPayStep] = useState<PayStep>('idle');
  const [payMode, setPayMode] = useState<'wallet' | 'sslcommerz' | 'later'>('wallet');
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const amt = parseFloat(payAmount) || 0;

  useEffect(() => {
    if (!shopId) return;
    getShopDetail({ shopId }).then(data => setShop(data.shop)).finally(() => setLoading(false));
  }, [shopId]);

  const handleToMethod = () => {
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setPayStep('method');
  };

  const handleToConfirm = () => setPayStep('confirm');

  const handlePay = () => {
    if (payMode === 'wallet') { setPinOpen(true); return; }
    if (payMode === 'sslcommerz') { handleSSLPay(); return; }
    handleWalletPay();
  };

  const handleWalletPay = async () => {
    if (!shop) return;
    setPayStep('processing');
    try {
      await payShop({ shopId: shop.id, shopName: shop.name, amount: amt, mode: payMode === 'later' ? 'later' : 'now' });
      setPayStep('success');
      refreshDashboard();
    } catch (e: any) { toast.error(e.message || 'Payment failed'); setPayStep('confirm'); }
  };

  const handleSSLPay = async () => {
    if (!shop) return;
    setPayStep('processing');
    try {
      const res = await initSSLPayment({ amount: amt, purpose: 'shop_payment', itemId: shop.id, itemLabel: `Shop Payment — ${shop.name}` });
      localStorage.setItem('ssl_payment', JSON.stringify({ ref: res.transactionRef, purpose: 'shop_payment', itemId: shop.id, amount: amt }));
      window.location.href = res.gatewayUrl;
    } catch (e: any) { toast.error(e.message || 'Payment gateway failed'); setPayStep('confirm'); }
  };

  const resetPay = () => { setPayStep('idle'); setPayAmount(''); setPayMode('wallet'); };

  if (loading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-6">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Store className="w-14 h-14 mx-auto mb-4 text-muted-foreground/20" />
        <h2 className="text-lg font-bold text-foreground mb-2">Shop not found</h2>
        <Button variant="outline" onClick={() => navigate('/student/shops')}><ArrowLeft className="w-4 h-4 mr-2" /> Back to Shops</Button>
      </div>
    );
  }

  if (payStep !== 'idle' && payStep !== 'success') {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={resetPay} className="p-2 rounded-xl hover:bg-accent transition-colors"><ArrowLeft className="w-5 h-5 text-muted-foreground" /></button>
          <div className="flex-1"><h1 className="text-lg font-bold text-foreground">Pay {shop.name}</h1></div>
        </div>

        <AnimatePresence mode="wait">
          {payStep === 'amount' && (
            <FadeIn key="amt">
              <div className="space-y-5">
                <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount (৳)</label>
                  <Input type="number" placeholder="0.00" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="mt-2 text-2xl font-bold h-14 text-center bg-accent/50 border-border/60" min={1} autoFocus />
                </div>
                <Button onClick={handleToMethod} className="w-full h-12 font-semibold" disabled={!amt || amt <= 0}>Continue <ChevronRight className="w-4 h-4 ml-1" /></Button>
              </div>
            </FadeIn>
          )}
          {payStep === 'method' && (
            <FadeIn key="method">
              <div className="space-y-4">
                <div className="text-center py-2"><span className="text-3xl font-bold text-foreground tabular">{formatCurrency(amt)}</span></div>
                {([
                  { key: 'wallet' as const, label: 'Campus Wallet', icon: Wallet, desc: `Balance: ${formatCurrency(wallet?.balance || 0)}` },
                  { key: 'sslcommerz' as const, label: 'Online Payment', icon: CreditCard, desc: 'Cards, bKash, Nagad, Rocket' },
                  { key: 'later' as const, label: 'Pay Later', icon: Clock, desc: '7-day payment deadline' },
                ]).map(m => (
                  <button key={m.key} onClick={() => setPayMode(m.key)}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all flex items-center gap-4 ${payMode === m.key ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-muted-foreground/30'}`}>
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${payMode === m.key ? 'bg-primary/15' : 'bg-accent'}`}>
                      <m.icon className={`w-5 h-5 ${payMode === m.key ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1"><span className={`font-semibold text-sm ${payMode === m.key ? 'text-primary' : 'text-foreground'}`}>{m.label}</span><span className="text-xs text-muted-foreground block">{m.desc}</span></div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${payMode === m.key ? 'border-primary' : 'border-border'}`}>{payMode === m.key && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}</div>
                  </button>
                ))}
                <Button onClick={handleToConfirm} className="w-full h-12 font-semibold">Continue <ChevronRight className="w-4 h-4 ml-1" /></Button>
              </div>
            </FadeIn>
          )}
          {payStep === 'confirm' && (
            <FadeIn key="confirm">
              <div className="space-y-5">
                <h2 className="text-lg font-bold text-foreground text-center">Review Payment</h2>
                <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-3">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Merchant</span><span className="font-semibold text-foreground">{shop.name}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount</span><span className="font-bold text-foreground tabular">{formatCurrency(amt)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Method</span><span className="font-medium text-foreground">{payMode === 'wallet' ? 'Campus Wallet' : payMode === 'sslcommerz' ? 'Online Payment' : 'Pay Later'}</span></div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-accent/30 p-3 rounded-xl"><Shield className="w-4 h-4 text-primary shrink-0" /><span>{payMode === 'sslcommerz' ? 'You will be redirected to the secure payment gateway.' : 'Secured with bank-grade encryption.'}</span></div>
                <Button onClick={handlePay} className="w-full h-12 font-semibold">{payMode === 'sslcommerz' ? 'Proceed to Payment' : payMode === 'later' ? 'Create Due' : `Pay ${formatCurrency(amt)}`}</Button>
              </div>
            </FadeIn>
          )}
          {payStep === 'processing' && (
            <motion.div key="proc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
              <div className="relative w-16 h-16 mx-auto mb-6"><div className="absolute inset-0 rounded-full border-2 border-primary/20" /><div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" /><Store className="absolute inset-0 m-auto w-6 h-6 text-primary" /></div>
              <p className="text-sm font-medium text-foreground">Processing...</p>
            </motion.div>
          )}
        </AnimatePresence>
        <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode="verify" onSuccess={handleWalletPay} />
      </div>
    );
  }

  if (payStep === 'success') {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-lg">
        <SuccessScreen
          title="Payment Successful!"
          subtitle={`${formatCurrency(amt)} ${payMode === 'later' ? 'due created for' : 'paid to'} ${shop.name}`}
          details={[
            { label: 'Merchant', value: shop.name },
            { label: 'Amount', value: formatCurrency(amt) },
            { label: 'Method', value: payMode === 'wallet' ? 'Campus Wallet' : payMode === 'sslcommerz' ? 'Online Payment' : 'Pay Later' },
          ]}
          actions={[
            { label: 'Back to Shop', onClick: resetPay, variant: 'outline' },
            { label: 'Done', onClick: () => navigate('/student') },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <button onClick={() => navigate('/student/shops')} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Shops
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FadeIn>
          <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
            <div className="w-full aspect-[2/1] bg-accent flex items-center justify-center">
              <Store className="w-14 h-14 text-muted-foreground/15" />
            </div>
            <div className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h1 className="text-2xl font-bold text-foreground">{shop.name}</h1>
                  <p className="text-sm text-muted-foreground mt-0.5">{CATEGORY_LABELS[shop.category] || shop.category}</p>
                </div>
                <StatusBadge status={shop.status.toLowerCase()} />
              </div>
              <div className="flex items-center gap-4 mt-4">
                <div className="flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-primary fill-primary" />
                  <span className="text-sm font-bold text-foreground">{shop.rating}</span>
                </div>
                {shop.location && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5" /> {shop.location}
                  </div>
                )}
              </div>
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/60 bg-card p-6 flex flex-col items-center">
              <div className="w-40 h-40 bg-accent rounded-2xl flex items-center justify-center mb-4">
                <QrCode className="w-16 h-16 text-muted-foreground/15" />
              </div>
              <p className="text-xs text-muted-foreground text-center">Scan this QR at the counter or tap below to pay</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button className="w-full h-12 font-semibold" onClick={() => { setPayMode('wallet'); setPayStep('amount'); }}>
                <Wallet className="w-4 h-4 mr-2" /> Pay with Wallet
              </Button>
              <Button variant="outline" className="w-full h-11" onClick={() => { setPayMode('sslcommerz'); setPayStep('amount'); }}>
                <CreditCard className="w-4 h-4 mr-2" /> Pay Online
              </Button>
              <Button variant="outline" className="w-full h-11" onClick={() => { setPayMode('later'); setPayStep('amount'); }}>
                <Clock className="w-4 h-4 mr-2" /> Pay Later
              </Button>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}

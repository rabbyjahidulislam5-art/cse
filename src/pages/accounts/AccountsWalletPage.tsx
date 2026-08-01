import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Wallet, QrCode, ArrowUpRight, ArrowDownLeft, Lock, RefreshCw, Loader2, ShieldCheck, History, Landmark, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import PinDialog from '@/components/PinDialog';
import AddMoneyModal from '@/components/AddMoneyModal';
import { toast } from 'sonner';
import { getAccountsWallet, type GetAccountsWalletOutputType } from '@/lib/api';
import { FadeIn } from '@/components/PageTransition';

export default function AccountsWalletPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<GetAccountsWalletOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<'set' | 'change'>('set');
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);

  const load = () => {
    getAccountsWallet({})
      .then(setData)
      .catch(() => toast.error('Failed to load wallet data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-6">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const w = data?.wallet;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-6">
      {/* Header */}
      <FadeIn>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Accounts Office Campus Wallet</h1>
            <p className="text-xs text-muted-foreground mt-0.5">ID: {w?.walletId} · Official Wallet</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setPinMode('change');
                setPinOpen(true);
              }}
              variant="outline"
              size="sm"
            >
              <Lock className="w-4 h-4 mr-1.5" /> PIN Settings
            </Button>
            <Button onClick={() => setAddMoneyOpen(true)} size="sm" className="shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4 mr-1.5" /> Deposit Funds
            </Button>
          </div>
        </div>
      </FadeIn>

      {/* Main Balance Card */}
      <FadeIn delay={0.05}>
        <div className="relative rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/5 p-6 overflow-hidden">
          <div className="absolute top-0 right-0 w-72 h-72 bg-primary/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Wallet className="w-4 h-4 text-primary" />
                <span className="text-xs uppercase tracking-wider font-semibold">Available Wallet Balance</span>
              </div>
              <p className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight tabular">
                ৳{(w?.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Daily Limit: ৳{(w?.dailyTransferred || 0).toLocaleString()} / ৳{(w?.dailyTransferLimit || 10000).toLocaleString()}
              </p>
            </div>

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-3 gap-2 shrink-0">
              <button
                onClick={() => navigate('/accounts/qr')}
                className="flex flex-col items-center justify-center p-3 rounded-xl bg-accent/50 hover:bg-accent border border-border/60 transition-all text-center group"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                  <QrCode className="w-5 h-5" />
                </div>
                <span className="text-xs font-semibold text-foreground">Official QR</span>
              </button>

              <button
                onClick={() => setAddMoneyOpen(true)}
                className="flex flex-col items-center justify-center p-3 rounded-xl bg-accent/50 hover:bg-accent border border-border/60 transition-all text-center group"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <span className="text-xs font-semibold text-foreground">Top Up</span>
              </button>

              <button
                onClick={() => navigate('/accounts/settlements')}
                className="flex flex-col items-center justify-center p-3 rounded-xl bg-accent/50 hover:bg-accent border border-border/60 transition-all text-center group"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <span className="text-xs font-semibold text-foreground">Settlements</span>
              </button>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Transaction History */}
      <FadeIn delay={0.1}>
        <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Recent Wallet Activity</h2>
            </div>
            <button onClick={load} className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>

          {!data?.recentTransactions?.length ? (
            <div className="text-center py-12 border border-dashed border-border/60 rounded-xl">
              <Wallet className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No wallet transactions recorded yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.recentTransactions.map(t => (
                <div key={t.id} className="flex items-center justify-between p-4 rounded-xl bg-accent/30 border border-border/40 hover:border-primary/20 transition-all">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      t.direction === 'Credit' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                    }`}>
                      {t.direction === 'Credit' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{t.type || t.description}</p>
                      <p className="text-xs text-muted-foreground font-mono">{t.reference} · {new Date(t.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className={`text-sm font-bold tabular ${
                      t.direction === 'Credit' ? 'text-emerald-500' : 'text-foreground'
                    }`}>
                      {t.direction === 'Credit' ? '+' : '-'}৳{t.amount.toLocaleString()}
                    </p>
                    <span className="text-[10px] text-muted-foreground font-medium uppercase">{t.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </FadeIn>

      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode={pinMode} onSuccess={load} />
      <AddMoneyModal open={addMoneyOpen} onOpenChange={(o) => { setAddMoneyOpen(o); if (!o) load(); }} />
    </div>
  );
}

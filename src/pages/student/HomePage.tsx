import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, ScanLine, FileWarning, ArrowRightLeft, Store, PlusCircle, GraduationCap, ShieldAlert, ArrowRight, RotateCcw, Lock, TrendingUp, TrendingDown, Receipt } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import WalletCard from '@/components/WalletCard';
import AddMoneyDialog from '@/components/AddMoneyDialog';
import PinDialog from '@/components/PinDialog';
import { useUser } from '@/lib/user-context';
import { getStudentDashboard, type GetStudentDashboardOutputType } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';

type TxType = GetStudentDashboardOutputType['recentTransactions'][0];

const typeIcons: Record<string, typeof Store> = {
  'Shop Payment': Store, 'Deposit': PlusCircle, 'Fee Payment': GraduationCap,
  'Fine Payment': ShieldAlert, 'Refund': RotateCcw, 'Mass Payment': FileWarning,
  'Top Up': Receipt, 'Transfer Sent': ArrowRightLeft, 'Transfer Received': PlusCircle,
};

const quickActions = [
  { label: 'Add Money', icon: Plus, action: 'add_money', color: 'from-primary/15 to-primary/5', iconColor: 'text-primary' },
  { label: 'Scan & Pay', icon: ScanLine, path: '/student/scan', color: 'from-secondary/15 to-secondary/5', iconColor: 'text-secondary' },
  { label: 'Transfer', icon: ArrowRightLeft, path: '/student/transfer', color: 'from-[hsl(var(--chart-3))]/15 to-[hsl(var(--chart-3))]/5', iconColor: 'text-[hsl(var(--chart-3))]' },
  { label: 'Dues', icon: FileWarning, path: '/student/dues', color: 'from-[hsl(var(--chart-4))]/15 to-[hsl(var(--chart-4))]/5', iconColor: 'text-[hsl(var(--chart-4))]' },
];

function TransactionRow({ tx, onReceipt, index }: { tx: TxType; onReceipt: (id: string) => void; index: number }) {
  const Icon = typeIcons[tx.type] || Store;
  const isCredit = tx.direction === 'Credit';
  return (
    <motion.button
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      onClick={() => onReceipt(tx.id)}
      className="w-full flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-card border border-border/60 hover:border-primary/20 hover:bg-card/80 transition-all text-left group"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${isCredit ? 'from-[hsl(var(--chart-3))]/15 to-[hsl(var(--chart-3))]/5' : 'from-accent to-accent'} flex items-center justify-center shrink-0`}>
          <Icon className={`w-4.5 h-4.5 ${isCredit ? 'text-[hsl(var(--chart-3))]' : 'text-muted-foreground'}`} />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground group-hover:text-foreground">{tx.description || tx.type}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{tx.type} · <span className="font-mono">{tx.reference}</span></div>
        </div>
      </div>
      <div className="text-right">
        <span className={`text-sm font-semibold tabular-nums flex items-center gap-1 ${isCredit ? 'text-[hsl(var(--chart-3))]' : 'text-foreground'}`}>
          {isCredit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3 text-muted-foreground" />}
          {isCredit ? '+' : '−'}{formatCurrency(tx.amount)}
        </span>
      </div>
    </motion.button>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { user, wallet, loading, setWalletBalance, refreshDashboard } = useUser();
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [recentTx, setRecentTx] = useState<TxType[]>([]);

  useEffect(() => {
    if (!user) return;
    getStudentDashboard({}).then(data => setRecentTx(data.recentTransactions));
  }, [user]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl space-y-6">
        <Skeleton className="h-6 w-56" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-48 rounded-2xl" />
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        </div>
        {[1,2,3].map(i => <Skeleton key={i} className="h-18 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              Welcome, <span className="text-gradient">{user?.fullName?.split(' ')[0] || 'Student'}</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage your campus finances</p>
          </div>
          {!user?.pinSet && (
            <motion.button
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              onClick={() => setPinOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[hsl(var(--chart-4))]/10 border border-[hsl(var(--chart-4))]/20 text-[hsl(var(--chart-4))] text-xs font-semibold hover:bg-[hsl(var(--chart-4))]/15 transition-colors"
            >
              <Lock className="w-3.5 h-3.5" /> Set Wallet PIN
            </motion.button>
          )}
        </div>
      </FadeIn>

      {/* Wallet + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-8">
        <FadeIn delay={0.1}>
          <WalletCard balance={wallet?.balance || 0} onAddMoney={() => setAddMoneyOpen(true)} />
        </FadeIn>
        <FadeIn delay={0.15} className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 h-full">
            {quickActions.map((qa, i) => (
              <motion.button
                key={qa.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.06 }}
                onClick={() => { if (qa.action === 'add_money') setAddMoneyOpen(true); else if (qa.path) navigate(qa.path); }}
                className="flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border border-border/60 bg-card hover:border-primary/20 transition-all group active:scale-[0.97]"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${qa.color} flex items-center justify-center group-hover:scale-105 transition-transform`}>
                  <qa.icon className={`w-5 h-5 ${qa.iconColor}`} />
                </div>
                <span className="text-xs font-semibold text-foreground">{qa.label}</span>
              </motion.button>
            ))}
          </div>
        </FadeIn>
      </div>

      {/* Recent Activity */}
      <FadeIn delay={0.25}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-foreground">Recent Activity</h2>
          <button onClick={() => navigate('/student/ledger')} className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline transition-colors">
            View All <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {recentTx.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-dashed border-border bg-card/50">
            <PlusCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground font-medium">No transactions yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add money to your wallet to get started</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentTx.map((tx, i) => <TransactionRow key={tx.id} tx={tx} index={i} onReceipt={(id) => navigate(`/student/receipt?txId=${id}`)} />)}
          </div>
        )}
      </FadeIn>

      <AddMoneyDialog open={addMoneyOpen} onOpenChange={setAddMoneyOpen}
        onSuccess={(newBal) => { setWalletBalance(newBal); refreshDashboard(); }} />
      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode="set" onSuccess={() => refreshDashboard()} />
    </div>
  );
}

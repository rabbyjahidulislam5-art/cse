import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, Users, ArrowUpRight, ScrollText, QrCode, Receipt, BarChart3, BookOpen,
  ShieldAlert, BookMarked, UserSearch, GraduationCap, Banknote, UserCheck,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getAccountsOverview, type GetAccountsOverviewOutputType } from '@/lib/api';
import { getDisputeBadgeCounts } from '@/lib/disputeApi';
import { useDisputeSocket } from '@/lib/socket';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';

const TakaIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <span className={`font-bold text-xl leading-none flex items-center justify-center select-none ${className}`}>৳</span>
);

export default function AccountsHomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<GetAccountsOverviewOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCases, setPendingCases] = useState(0);
  useEffect(() => { getAccountsOverview({}).then(setData).finally(() => setLoading(false)); }, []);

  // Settlement/Fee Push/Disputes (still nav tabs) plus every item that lived in the old "More"
  // dropdown now live here as icon tiles, matching the Admin/Student/Library dashboard pattern.
  useEffect(() => {
    const fetchBadge = () => getDisputeBadgeCounts().then(r => setPendingCases(r.pendingCases)).catch(() => {});
    fetchBadge();
    const interval = setInterval(fetchBadge, 30000);
    return () => clearInterval(interval);
  }, []);
  useDisputeSocket(() => setPendingCases(c => c + 1));

  const quickActions = [
    { label: 'Settlement', icon: ArrowUpRight, onClick: () => navigate('/accounts/settlements'), color: 'from-primary/15 to-primary/5', iconColor: 'text-primary' },
    { label: 'Fee Push', icon: Users, onClick: () => navigate('/accounts/fee-wizard'), color: 'from-secondary/15 to-secondary/5', iconColor: 'text-secondary' },
    { label: 'Disputes', icon: ScrollText, onClick: () => navigate('/accounts/disputes'), color: 'from-destructive/15 to-destructive/5', iconColor: 'text-destructive', badge: pendingCases },
    { label: 'Payment QR', icon: QrCode, onClick: () => navigate('/accounts/qr'), color: 'from-[hsl(var(--chart-2))]/15 to-[hsl(var(--chart-2))]/5', iconColor: 'text-[hsl(var(--chart-2))]' },
    { label: 'Adjust', icon: Receipt, onClick: () => navigate('/accounts/adjustments'), color: 'from-[hsl(var(--chart-3))]/15 to-[hsl(var(--chart-3))]/5', iconColor: 'text-[hsl(var(--chart-3))]' },
    { label: 'Analytics', icon: BarChart3, onClick: () => navigate('/accounts/analytics'), color: 'from-[hsl(var(--chart-4))]/15 to-[hsl(var(--chart-4))]/5', iconColor: 'text-[hsl(var(--chart-4))]' },
    { label: 'Ledger', icon: BookOpen, onClick: () => navigate('/accounts/ledger'), color: 'from-[hsl(var(--chart-5))]/15 to-[hsl(var(--chart-5))]/5', iconColor: 'text-[hsl(var(--chart-5))]' },
    { label: 'Admin Fines', icon: ShieldAlert, onClick: () => navigate('/accounts/admin-fines'), color: 'from-[hsl(var(--chart-5))]/15 to-[hsl(var(--chart-5))]/5', iconColor: 'text-[hsl(var(--chart-5))]' },
    { label: 'Library Fines', icon: BookMarked, onClick: () => navigate('/accounts/library-fines'), color: 'from-[hsl(var(--chart-3))]/15 to-[hsl(var(--chart-3))]/5', iconColor: 'text-[hsl(var(--chart-3))]' },
    { label: 'Student Profile', icon: UserSearch, onClick: () => navigate('/accounts/student-profile'), color: 'from-[hsl(var(--chart-2))]/15 to-[hsl(var(--chart-2))]/5', iconColor: 'text-[hsl(var(--chart-2))]' },
    { label: 'Scholarship Push', icon: GraduationCap, onClick: () => navigate('/accounts/scholarship-push'), color: 'from-secondary/15 to-secondary/5', iconColor: 'text-secondary' },
    { label: 'Push Records', icon: UserSearch, onClick: () => navigate('/accounts/push-records'), color: 'from-primary/15 to-primary/5', iconColor: 'text-primary' },
    { label: 'Bank Payment', icon: Banknote, onClick: () => navigate('/accounts/manual-payment'), color: 'from-[hsl(var(--chart-4))]/15 to-[hsl(var(--chart-4))]/5', iconColor: 'text-[hsl(var(--chart-4))]' },
    { label: 'Profile', icon: UserCheck, onClick: () => navigate('/accounts/profile'), color: 'from-primary/15 to-primary/5', iconColor: 'text-primary' },
  ];

  if (loading) return <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-6"><Skeleton className="h-8 w-48" /><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[1,2].map(i => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div></div>;

  const chartData = [
    { name: 'Paid', value: data?.totalPaid || 0 },
    { name: 'Outstanding', value: data?.totalOutstanding || 0 },
  ];
  const COLORS = ['hsl(var(--chart-3))', 'hsl(var(--chart-4))'];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-xl font-bold text-foreground mb-6">Accounts Dashboard</motion.h1>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-8">
        {quickActions.map((qa, i) => (
          <motion.button
            key={qa.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={qa.onClick}
            className="relative flex flex-col items-center justify-center gap-3 p-4 sm:p-5 rounded-2xl border border-border/60 bg-card hover:border-primary/20 transition-all group active:scale-[0.97]"
          >
            {!!qa.badge && qa.badge > 0 && (
              <span className="absolute top-2.5 right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">
                {qa.badge > 99 ? '99+' : qa.badge}
              </span>
            )}
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${qa.color} flex items-center justify-center group-hover:scale-105 transition-transform`}>
              <qa.icon className={`w-5 h-5 ${qa.iconColor}`} />
            </div>
            <span className="text-xs font-semibold text-foreground text-center">{qa.label}</span>
          </motion.button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <motion.button initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={() => navigate('/accounts/analytics')}
          className="rounded-2xl border border-border/60 bg-card p-6 text-left hover:border-primary/30 transition-all">
          <div className="flex items-center gap-4">
            <div className="w-24 h-24">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={chartData} innerRadius={25} outerRadius={40} dataKey="value" strokeWidth={0}>
                  {chartData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie></PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">{data?.collectionPercent || 0}%</p>
              <p className="text-sm font-medium text-foreground">Collection Rate</p>
              <p className="text-xs text-muted-foreground mt-0.5">Paid vs Outstanding</p>
            </div>
          </div>
        </motion.button>

        <motion.button initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          onClick={() => navigate('/accounts/analytics')}
          className="rounded-2xl border border-border/60 bg-card p-6 text-left hover:border-primary/30 transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
              <TakaIcon className="w-6 h-6 text-destructive" />
            </div>
            <span className="text-2xl font-bold text-foreground tabular">৳{(data?.totalOutstanding || 0).toLocaleString()}</span>
          </div>
          <p className="text-sm font-semibold text-foreground">Total Outstanding</p>
          <p className="text-xs text-muted-foreground mt-0.5">{data?.pendingCount || 0} pending fees</p>
        </motion.button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Assigned', value: `৳${(data?.totalAssigned || 0).toLocaleString()}`, icon: TrendingUp, color: 'text-primary' },
          { label: 'Total Received', value: `৳${(data?.totalPaid || 0).toLocaleString()}`, icon: TakaIcon, color: 'text-[hsl(var(--chart-3))]' },
          { label: 'Total Students', value: String(data?.totalStudents || 0), icon: Users, color: 'text-[hsl(var(--chart-4))]' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05 }}
            className="p-4 sm:p-6 rounded-2xl border border-border/60 bg-card flex flex-col sm:block items-center justify-center sm:text-center gap-1 sm:gap-0">
            <s.icon className={`w-6 h-6 sm:w-5 sm:h-5 sm:mx-auto sm:mb-2 ${s.color}`} />
            <p className="text-2xl sm:text-lg font-bold text-foreground tabular">{s.value}</p>
            <p className="text-xs sm:text-[10px] text-muted-foreground">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

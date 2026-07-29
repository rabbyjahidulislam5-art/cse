import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Users, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getAccountsOverview, type GetAccountsOverviewOutputType } from '@/lib/api';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';

const TakaIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <span className={`font-bold text-xl leading-none flex items-center justify-center select-none ${className}`}>৳</span>
);

export default function AccountsHomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<GetAccountsOverviewOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getAccountsOverview({}).then(setData).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-6"><Skeleton className="h-8 w-48" /><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[1,2].map(i => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div></div>;

  const chartData = [
    { name: 'Paid', value: data?.totalPaid || 0 },
    { name: 'Outstanding', value: data?.totalOutstanding || 0 },
  ];
  const COLORS = ['hsl(var(--chart-3))', 'hsl(var(--chart-4))'];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-xl font-bold text-foreground mb-6">Accounts Dashboard</motion.h1>

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

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Assigned', value: `৳${(data?.totalAssigned || 0).toLocaleString()}`, icon: TrendingUp, color: 'text-primary' },
          { label: 'Total Paid', value: `৳${(data?.totalPaid || 0).toLocaleString()}`, icon: TakaIcon, color: 'text-[hsl(var(--chart-3))]' },
          { label: 'Total Students', value: String(data?.totalStudents || 0), icon: Users, color: 'text-[hsl(var(--chart-4))]' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05 }}
            className="p-4 rounded-xl border border-border/60 bg-card text-center">
            <s.icon className={`w-5 h-5 mx-auto mb-2 ${s.color}`} />
            <p className="text-lg font-bold text-foreground tabular">{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

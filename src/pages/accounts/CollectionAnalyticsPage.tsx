import { useState, useEffect } from 'react';
import { Filter, BarChart3 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getCollectionAnalytics, type GetCollectionAnalyticsOutputType } from '@/lib/api';
import { motion } from 'framer-motion';

export default function CollectionAnalyticsPage() {
  const [data, setData] = useState<GetCollectionAnalyticsOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [dept, setDept] = useState('');

  const load = (department?: string) => {
    setLoading(true);
    getCollectionAnalytics({ department: department || undefined }).then(setData).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading && !data) return <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-60 rounded-2xl" /></div>;

  const chartData = [
    { name: 'Paid', value: data?.overall?.paid || 0 },
    { name: 'Pending', value: data?.overall?.pending || 0 },
  ];
  const COLORS = ['hsl(var(--chart-3))', 'hsl(var(--chart-4))'];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-foreground">Collection Analytics</h1>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={dept} onValueChange={v => { setDept(v); load(v === 'all' ? undefined : v); }}>
            <SelectTrigger className="w-48 bg-accent/50 border-border/60"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {data?.departments?.map(d => <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/60 bg-card p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="w-48 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={chartData} innerRadius={50} outerRadius={80} dataKey="value" strokeWidth={0}>
                {chartData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie><Tooltip formatter={(v: any) => `৳${Number(v || 0).toLocaleString()}`} /></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[hsl(var(--chart-3))]" />
              <span className="text-sm text-foreground">Paid: <span className="font-bold tabular">৳{(data?.overall?.paid || 0).toLocaleString()}</span></span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[hsl(var(--chart-4))]" />
              <span className="text-sm text-foreground">Pending: <span className="font-bold tabular">৳{(data?.overall?.pending || 0).toLocaleString()}</span></span>
            </div>
            <p className="text-2xl font-bold text-primary">{data?.overall?.percent || 0}% Collected</p>
          </div>
        </div>
      </motion.div>

      {data?.departments?.length === 0 ? (
        <div className="text-center py-12"><BarChart3 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-sm text-muted-foreground">No data available</p></div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-5 gap-2 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span className="col-span-2">Department</span><span>Students</span><span>Collected</span><span className="text-right">Outstanding</span>
          </div>
          {data?.departments?.map((d, i) => (
            <motion.div key={d.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="grid grid-cols-5 gap-2 items-center p-4 rounded-xl border border-border/60 bg-card">
              <div className="col-span-2">
                <p className="text-sm font-semibold text-foreground">{d.name}</p>
                <div className="w-full h-1.5 rounded-full bg-accent mt-1.5"><div className="h-full rounded-full bg-[hsl(var(--chart-3))]" style={{ width: `${d.percent}%` }} /></div>
              </div>
              <p className="text-sm text-foreground tabular">{d.students}</p>
              <p className="text-sm text-[hsl(var(--chart-3))] font-medium tabular">{d.percent}%</p>
              <p className="text-sm font-bold text-foreground tabular text-right">৳{(d.pendingAmount || 0).toLocaleString()}</p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

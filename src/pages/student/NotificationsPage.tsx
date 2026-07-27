import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Bell, CreditCard, AlertTriangle, Clock, Info } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getNotifications, type GetNotificationsOutputType } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { FadeIn } from '@/components/PageTransition';

type Notification = GetNotificationsOutputType['notifications'][0];

const typeConfig: Record<string, { icon: typeof Bell; color: string; bg: string }> = {
  payment: { icon: CreditCard, color: 'text-primary', bg: 'bg-primary/10' },
  due: { icon: Clock, color: 'text-[hsl(var(--chart-4))]', bg: 'bg-[hsl(var(--chart-4))]/10' },
  alert: { icon: AlertTriangle, color: 'text-destructive', bg: 'bg-destructive/10' },
  info: { icon: Info, color: 'text-secondary', bg: 'bg-secondary/10' },
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getNotifications({}).then(res => setNotifications(res.notifications)).finally(() => setLoading(false));
  }, [user]);

  const unread = notifications.filter(n => !n.read);
  const read = notifications.filter(n => n.read);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">Notifications</h1>
          {unread.length > 0 && <p className="text-xs text-primary font-semibold">{unread.length} new</p>}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-18 rounded-xl" />)}</div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed border-border bg-card/50">
          <Bell className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground">No notifications yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">We'll notify you about payments, dues, and alerts</p>
        </div>
      ) : (
        <div className="space-y-6">
          {unread.length > 0 && (
            <div>
              <h2 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-3">New</h2>
              <div className="flex flex-col gap-2">
                {unread.map((n, i) => <NotificationItem key={n.id} notification={n} index={i} />)}
              </div>
            </div>
          )}
          {read.length > 0 && (
            <div>
              <h2 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Earlier</h2>
              <div className="flex flex-col gap-2">
                {read.map((n, i) => <NotificationItem key={n.id} notification={n} index={i} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationItem({ notification: n, index }: { notification: Notification; index: number }) {
  const cfg = typeConfig[n.type] || typeConfig.info;
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`flex items-start gap-3.5 p-4 rounded-xl border transition-all ${
        n.read ? 'border-border/40 bg-card' : 'border-primary/15 bg-primary/[0.03]'
      }`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${n.read ? 'bg-accent' : cfg.bg}`}>
        <Icon className={`w-4.5 h-4.5 ${n.read ? 'text-muted-foreground' : cfg.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-foreground">{n.title}</div>
          {!n.read && <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0 mt-1" />}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</div>
      </div>
    </motion.div>
  );
}

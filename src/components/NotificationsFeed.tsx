import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bell, Wallet, CreditCard, ShieldAlert, UserCog, Scale, CheckCheck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getNotifications, markNotificationRead, type NotificationItem } from '@/lib/api';
import { useNotificationSocket } from '@/lib/socket';
import { FadeIn } from '@/components/PageTransition';

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof Bell; color: string; bg: string }> = {
  wallet: { label: 'Wallet', icon: Wallet, color: 'text-primary', bg: 'bg-primary/10' },
  payment: { label: 'Payment', icon: CreditCard, color: 'text-[hsl(var(--chart-4))]', bg: 'bg-[hsl(var(--chart-4))]/10' },
  security: { label: 'Security', icon: ShieldAlert, color: 'text-destructive', bg: 'bg-destructive/10' },
  account: { label: 'Account', icon: UserCog, color: 'text-secondary', bg: 'bg-secondary/10' },
  dispute: { label: 'Disputes', icon: Scale, color: 'text-[hsl(var(--chart-2))]', bg: 'bg-[hsl(var(--chart-2))]/10' },
};

/** Role-agnostic notification feed — reused as-is by every dashboard's Notifications page. */
export default function NotificationsFeed() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getNotifications({}).then(res => setNotifications(res.notifications)).finally(() => setLoading(false));
  }, []);

  // This component is only ever rendered inside a role layout that already gates on
  // authentication (useAuth), so it can load immediately on mount — it must not depend on
  // useUser(), which is Student-dashboard-specific and would never resolve for other roles.
  useEffect(() => { load(); }, [load]);

  useNotificationSocket((payload) => {
    setNotifications(prev => [
      { id: payload.id, source: 'general', category: payload.category, type: payload.type, title: payload.title, body: payload.body, link: payload.link || '', read: false, createdAt: payload.createdAt },
      ...prev,
    ]);
  });

  const unread = notifications.filter(n => !n.read);
  const read = notifications.filter(n => n.read);
  const totalUnread = unread.length;

  const handleClick = async (n: NotificationItem) => {
    if (!n.read) {
      setNotifications(prev => prev.map(x => (x.id === n.id ? { ...x, read: true } : x)));
      markNotificationRead({ id: n.id, source: n.source }).catch(() => {});
    }
    if (n.link) navigate(n.link);
  };

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    markNotificationRead({}).catch(() => {});
  };

  return (
    <FadeIn>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Notifications</h1>
          {totalUnread > 0 && <p className="text-xs text-primary font-semibold">{totalUnread} new</p>}
        </div>
        {totalUnread > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent transition-colors shrink-0"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-18 rounded-xl" />)}</div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed border-border bg-card/50">
          <Bell className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground">No notifications yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">We'll notify you about payments, wallet activity, and security alerts</p>
        </div>
      ) : (
        <div className="space-y-6">
          {unread.length > 0 && (
            <div>
              <h2 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-3">New</h2>
              <div className="flex flex-col gap-2">
                {unread.map((n, i) => <NotificationRow key={n.id} notification={n} index={i} onClick={() => handleClick(n)} />)}
              </div>
            </div>
          )}
          {read.length > 0 && (
            <div>
              <h2 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Earlier</h2>
              <div className="flex flex-col gap-2">
                {read.map((n, i) => <NotificationRow key={n.id} notification={n} index={i} onClick={() => handleClick(n)} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </FadeIn>
  );
}

function NotificationRow({ notification: n, index, onClick }: { notification: NotificationItem; index: number; onClick: () => void }) {
  const cfg = CATEGORY_CONFIG[n.category] || CATEGORY_CONFIG.account;
  const Icon = cfg.icon;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`flex items-start gap-3.5 p-4 rounded-xl border text-left transition-all w-full ${
        n.read ? 'border-border/40 bg-card hover:bg-accent/50' : 'border-primary/15 bg-primary/[0.03] hover:bg-primary/[0.06]'
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
        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>
        <div className="text-[10px] text-muted-foreground/60 mt-1">{new Date(n.createdAt).toLocaleString()}</div>
      </div>
    </motion.button>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { getUnreadNotificationCount } from '@/lib/api';
import { useNotificationSocket, useDisputeSocket } from '@/lib/socket';

/** Shared bell + unread badge used by every dashboard's top bar — links to that role's /notifications page. */
export default function NotificationBell({ to, className = '' }: { to: string; className?: string }) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  const fetchCount = () => getUnreadNotificationCount().then(r => setCount(r.unreadCount)).catch(() => {});

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useNotificationSocket(() => setCount(c => c + 1));
  useDisputeSocket(() => setCount(c => c + 1));

  return (
    <button
      onClick={() => navigate(to)}
      className={`relative p-2.5 rounded-xl hover:bg-accent/80 transition-all duration-200 group ${className}`}
    >
      <Bell className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center ring-2 ring-background">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import NotificationsFeed from '@/components/NotificationsFeed';

export default function NotificationsPage() {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>
      <NotificationsFeed />
    </div>
  );
}

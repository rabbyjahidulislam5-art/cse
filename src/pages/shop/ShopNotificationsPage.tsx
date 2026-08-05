import NotificationsFeed from '@/components/NotificationsFeed';
import BackButton from '@/components/BackButton';

export default function ShopNotificationsPage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <BackButton fallback="/shop" />
      <NotificationsFeed />
    </div>
  );
}

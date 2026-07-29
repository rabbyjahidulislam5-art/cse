import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, Store, Search, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getShops, type GetShopsOutputType } from '@/lib/api';
import { CATEGORY_LABELS } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';

type ShopType = GetShopsOutputType['shops'][0];

const categories = ['all', 'food_beverage', 'stationery', 'printing', 'other'] as const;
const categoryLabels: Record<string, string> = { all: 'All Shops', food_beverage: 'Food & Beverage', stationery: 'Stationery', printing: 'Printing', other: 'Other' };

export default function ShopsPage() {
  const [activeCategory, setActiveCategory] = useState('all');
  const [shops, setShops] = useState<ShopType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    getShops({ category: activeCategory }).then(data => setShops(data.shops)).finally(() => setLoading(false));
  }, [activeCategory]);

  const filtered = search ? shops.filter(s => s.name.toLowerCase().includes(search.toLowerCase())) : shops;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
      <FadeIn>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Campus Shops</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Browse and pay at campus merchants</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input aria-label="Search shops" placeholder="Search shops..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-accent/50 border-border/60" />
          </div>
        </div>
      </FadeIn>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1 no-scrollbar">
        {categories.map((cat) => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
              activeCategory === cat
                ? 'gradient-primary text-primary-foreground shadow-lg shadow-primary/20'
                : 'bg-card border border-border/60 text-muted-foreground hover:border-primary/20 hover:text-foreground'
            }`}>
            {categoryLabels[cat]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-56 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed border-border bg-card/50">
          <Store className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground">No shops found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Try a different category or search term</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {filtered.map((shop, i) => (
            <motion.button
              key={shop.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              onClick={() => navigate(`/student/shops/${shop.id}`)}
              className="text-left rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/20 transition-all group"
            >
              <div className="w-full aspect-[3/2] bg-accent flex items-center justify-center relative overflow-hidden">
                <Store className="w-10 h-10 text-muted-foreground/20 group-hover:text-primary/30 transition-colors" />
                <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-background/80 backdrop-blur-sm">
                  <Star className="w-3 h-3 text-primary fill-primary" />
                  <span className="text-[11px] font-bold text-foreground">{shop.rating}</span>
                </div>
              </div>
              <div className="p-3.5">
                <div className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">{shop.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{CATEGORY_LABELS[shop.category] || shop.category}</div>
                {shop.location && (
                  <div className="flex items-center gap-1 mt-2 text-[11px] text-muted-foreground/60">
                    <MapPin className="w-3 h-3" /> {shop.location}
                  </div>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface MoreMenuItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
  badge?: ReactNode;
}

interface MoreMenuProps {
  items: MoreMenuItem[];
  /** Unique layoutId prefix for framer-motion (avoids collisions between layouts). */
  layoutPrefix: string;
  /** Whether to render in mobile mode (bottom sheet) vs desktop (dropdown). Only used for the mobile bottom nav. */
  mobile?: boolean;
}

/** Desktop dropdown variant — opens below the "More" button in the top nav bar. */
export function MoreMenuDesktop({ items, layoutPrefix }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Check if any overflow item is the active page
  const isOverflowActive = items.some(item =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
  );

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Close on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
          isOverflowActive || open
            ? 'text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {(isOverflowActive || open) && (
          <motion.div
            layoutId={`${layoutPrefix}-more-indicator`}
            className="absolute inset-0 gradient-primary rounded-lg shadow-lg shadow-primary/20"
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          />
        )}
        <span className="relative z-10 flex items-center gap-2">
          <MoreHorizontal className="w-4 h-4" />
          More
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute right-0 top-full mt-2 w-52 rounded-xl glass-strong border border-border/60 shadow-2xl p-1.5 z-50"
          >
            {items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                  }`
                }
              >
                <item.icon className="w-4 h-4" />
                <span className="flex-1">{item.label}</span>
                {item.badge}
              </NavLink>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Mobile bottom sheet variant — slides up from the bottom on mobile screens. */
export function MoreMenuMobile({ items, layoutPrefix }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Check if any overflow item is the active page
  const isOverflowActive = items.some(item =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
  );

  // Close on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 ${
          isOverflowActive ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        <MoreHorizontal className={`w-5 h-5 transition-all ${isOverflowActive ? 'scale-110' : ''}`} />
        <span className="text-[10px] font-semibold">More</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
            />

            {/* Bottom Sheet */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              className="fixed bottom-0 left-0 right-0 z-[70] glass-strong rounded-t-3xl border-t border-border/60 shadow-2xl safe-area-bottom"
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-border/80" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pb-3 pt-1">
                <h3 className="text-sm font-bold text-foreground">More</h3>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Items */}
              <div className="px-4 pb-6 space-y-1">
                {items.map((item, i) => (
                  <motion.div
                    key={item.to}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-4 px-4 py-3.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                          isActive
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/60 border border-transparent'
                        }`
                      }
                    >
                      <div className="w-10 h-10 rounded-xl bg-accent/60 flex items-center justify-center shrink-0">
                        <item.icon className="w-5 h-5" />
                      </div>
                      <span className="flex-1">{item.label}</span>
                      {item.badge}
                    </NavLink>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

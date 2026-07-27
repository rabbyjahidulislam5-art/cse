import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { motion } from 'framer-motion';
import { GraduationCap, Wallet, Shield, CreditCard, QrCode, ArrowRightLeft, ChevronRight, Sparkles, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  { icon: Wallet, title: 'Digital Wallet', desc: 'Secure campus wallet with real-time balance and instant transactions', color: 'from-primary/20 to-primary/5' },
  { icon: QrCode, title: 'QR Payments', desc: 'Scan and pay at any campus merchant in seconds', color: 'from-secondary/20 to-secondary/5' },
  { icon: ArrowRightLeft, title: 'Instant Transfer', desc: 'Send money to fellow students instantly with PIN security', color: 'from-[hsl(var(--chart-3))]/20 to-[hsl(var(--chart-3))]/5' },
  { icon: CreditCard, title: 'Pay Dues & Fees', desc: 'Semester fees, library fines, and admin charges in one place', color: 'from-[hsl(var(--chart-4))]/20 to-[hsl(var(--chart-4))]/5' },
  { icon: Shield, title: 'Bank-Grade Security', desc: 'PIN, OTP, fraud detection, and encrypted transactions', color: 'from-primary/20 to-primary/5' },
  { icon: Lock, title: 'Payment Gateway', desc: 'Top up via cards, bKash, Nagad, Rocket & more', color: 'from-secondary/20 to-secondary/5' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, isLoading, loginWithRedirect } = useAuth();

  useEffect(() => {
    if (!isLoading && user) {
      const role = (user as any).role;
      if (role === 'Admin Office') navigate('/admin', { replace: true });
      else if (role === 'Library') navigate('/library', { replace: true });
      else if (role === 'Accounts Office') navigate('/accounts', { replace: true });
      else if (role === 'Shop Staff') navigate('/shop', { replace: true });
      else navigate('/student', { replace: true });
    }
  }, [isLoading, user, navigate]);

  const handleLogin = () => loginWithRedirect({ initialView: 'login', redirectUrl: `${window.location.origin}/` });
  const handleSignup = () => loginWithRedirect({ initialView: 'signup', redirectUrl: `${window.location.origin}/` });

  // Show nothing while checking auth or redirecting logged-in user
  if (isLoading || user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20 animate-pulse">
          <GraduationCap className="w-5 h-5 text-primary-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/[0.04] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[400px] bg-secondary/[0.03] rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10">
        <div className="container mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <GraduationCap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <span className="font-bold text-foreground text-base tracking-tight">Smart Campus</span>
              <span className="text-[10px] text-muted-foreground block -mt-0.5">Digital Wallet</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={handleLogin} className="text-sm">Sign In</Button>
            <Button onClick={handleSignup} className="text-sm shadow-lg shadow-primary/20">Get Started</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 pt-16 sm:pt-24 pb-20 sm:pb-32">
        <div className="container mx-auto px-4 sm:px-6 text-center max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-8">
              <Sparkles className="w-4 h-4" />
              University Financial Platform
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-foreground tracking-tight leading-[1.1] mb-6"
          >
            Your Campus,{' '}
            <span className="text-gradient">One Wallet</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Pay shops, transfer money, clear dues, and manage your university finances — all from one secure digital wallet.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Button size="lg" onClick={handleSignup} className="text-base px-8 py-6 shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-shadow">
              Open Your Wallet
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
            <Button size="lg" variant="outline" onClick={handleLogin} className="text-base px-8 py-6">
              Sign In to Dashboard
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Features grid */}
      <section className="relative z-10 pb-24 sm:pb-32">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">Everything You Need</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">A complete financial ecosystem designed for university life.</p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="group rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-6 hover:border-primary/20 hover:bg-card transition-all duration-300"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}>
                  <f.icon className="w-6 h-6 text-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground mb-1.5">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border py-8">
        <div className="container mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-primary" />
            <span className="text-sm text-muted-foreground">Smart Campus © {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="w-3 h-3" />
            Bank-Grade Encryption · Secure Payments
          </div>
        </div>
      </footer>
    </div>
  );
}

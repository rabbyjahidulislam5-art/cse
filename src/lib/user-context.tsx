import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getStudentDashboard, type GetStudentDashboardOutputType } from '@/lib/api';

type UserData = GetStudentDashboardOutputType['user'];
type WalletData = GetStudentDashboardOutputType['wallet'];
type TxData = GetStudentDashboardOutputType['recentTransactions'];

interface UserContextType {
  user: UserData | null;
  wallet: WalletData | null;
  recentTransactions: TxData;
  loading: boolean;
  refreshDashboard: () => Promise<void>;
  setWalletBalance: (balance: number) => void;
}

const UserContext = createContext<UserContextType>({
  user: null, wallet: null, recentTransactions: [], loading: true,
  refreshDashboard: async () => {},
  setWalletBalance: () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const { user: authUser, isLoading: authLoading, loginWithRedirect } = useAuth();
  const [user, setUser] = useState<UserData | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<TxData>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !authUser) {
      loginWithRedirect({ redirectUrl: window.location.href });
    }
  }, [authLoading, authUser, loginWithRedirect]);

  const refreshDashboard = async () => {
    try {
      const data = await getStudentDashboard({});
      setUser(data.user);
      setWallet(data.wallet);
      setRecentTransactions(data.recentTransactions);
    } catch (e) {
      console.error('Dashboard fetch error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authUser) return;
    refreshDashboard();
  }, [authUser]);

  const setWalletBalance = (balance: number) => {
    setWallet(prev => prev ? { ...prev, balance } : prev);
  };

  if (authLoading || !authUser) return null;

  return (
    <UserContext.Provider value={{ user, wallet, recentTransactions, loading, refreshDashboard, setWalletBalance }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}

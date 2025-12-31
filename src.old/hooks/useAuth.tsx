import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/demo/isDemo";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_USER: User = {
  id: "demo-user",
  aud: "authenticated",
  role: "authenticated",
  email: "demo@aostot.local",
  app_metadata: { provider: "demo", providers: ["demo"] },
  user_metadata: { full_name: "Demo User" },
  created_at: new Date().toISOString(),
} as any;

const DEMO_SESSION: Session = {
  access_token: "demo-access-token",
  refresh_token: "demo-refresh-token",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: DEMO_USER,
} as any;

export function AuthProvider({ children }: { children: ReactNode }) {
  const demo = isDemoMode();

  const [user, setUser] = useState<User | null>(() => (demo ? DEMO_USER : null));
  const [session, setSession] = useState<Session | null>(() => (demo ? DEMO_SESSION : null));
  const [loading, setLoading] = useState(() => !demo);

  useEffect(() => {
    if (demo) {
      // Auto-sign-in in demo mode so you can view the entire app.
      setUser(DEMO_USER);
      setSession(DEMO_SESSION);
      setLoading(false);
      return;
    }

    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [demo]);

  const signIn = async (email: string, password: string) => {
    if (demo) {
      setUser(DEMO_USER);
      setSession(DEMO_SESSION);
      return { error: null };
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? new Error(error.message) : null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUp = async (email: string, password: string) => {
    if (demo) {
      setUser(DEMO_USER);
      setSession(DEMO_SESSION);
      return { error: null };
    }

    try {
      const redirectUrl = `${window.location.origin}/`;
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl },
      });
      return { error: error ? new Error(error.message) : null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    if (demo) {
      setUser(null);
      setSession(null);
      return;
    }
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

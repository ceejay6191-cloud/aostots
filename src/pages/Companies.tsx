import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

const db = supabase as any;

type CompanyRow = {
  id: string;
  name: string;
  owner_id: string;
  join_code: string;
};

type MembershipRow = {
  id: string;
  company_id: string;
  user_id: string;
  role: "owner" | "admin" | "manager" | "member";
  status: "pending" | "active" | "blocked";
  company: CompanyRow | null;
};

export default function Companies() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [createName, setCreateName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [pending, setPending] = useState<MembershipRow[]>([]);

  const activeCompanies = useMemo(
    () => memberships.filter((m) => m.status === "active" && m.company),
    [memberships]
  );

  const adminCompanyIds = useMemo(
    () =>
      activeCompanies
        .filter((m) => ["owner", "admin", "manager"].includes(m.role))
        .map((m) => m.company_id),
    [activeCompanies]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) return;
      try {
        setLoading(true);
        const { data, error } = await db
          .from("company_memberships")
          .select("id,company_id,user_id,role,status,company:companies(id,name,owner_id,join_code)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (!cancelled) setMemberships((data ?? []) as MembershipRow[]);
      } catch (e: any) {
        if (!cancelled) {
          setMemberships([]);
          toast({
            title: "Could not load companies",
            description: e?.message ?? "Please try again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!adminCompanyIds.length) {
        setPending([]);
        return;
      }
      const { data, error } = await db
        .from("company_memberships")
        .select("id,company_id,user_id,role,status,company:companies(id,name,owner_id,join_code)")
        .in("company_id", adminCompanyIds)
        .eq("status", "pending");
      if (error || cancelled) return;
      setPending((data ?? []) as MembershipRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [adminCompanyIds]);

  async function handleCreateCompany() {
    const name = createName.trim();
    if (!name || !user?.id) return;
    const { error } = await db.from("companies").insert({ name, owner_id: user.id });
    if (error) {
      toast({ title: "Create failed", description: error.message, variant: "destructive" });
      return;
    }
    setCreateName("");
    window.location.reload();
  }

  async function handleJoinCompany() {
    const code = joinCode.trim();
    if (!code || !user?.id) return;
    const { data, error } = await db.rpc("find_company_by_join_code", { code });
    if (error || !data?.length) {
      toast({ title: "Join failed", description: error?.message ?? "Invalid code." });
      return;
    }
    const company = data[0] as { id: string; name: string };
    const { error: joinError } = await db.from("company_memberships").insert({
      company_id: company.id,
      user_id: user.id,
      role: "member",
      status: "pending",
      created_by: user.id,
    });
    if (joinError) {
      toast({ title: "Join failed", description: joinError.message, variant: "destructive" });
      return;
    }
    setJoinCode("");
    window.location.reload();
  }

  async function approveMembership(id: string) {
    const { error } = await db
      .from("company_memberships")
      .update({ status: "active", approved_at: new Date().toISOString(), approved_by: user?.id })
      .eq("id", id);
    if (error) {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      return;
    }
    window.location.reload();
  }

  async function denyMembership(id: string) {
    const { error } = await db.from("company_memberships").delete().eq("id", id);
    if (error) {
      toast({ title: "Deny failed", description: error.message, variant: "destructive" });
      return;
    }
    window.location.reload();
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="text-2xl font-semibold">Company Teams</div>
          <div className="text-sm text-muted-foreground">Manage company memberships and approvals.</div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-4">
            <div className="text-sm font-semibold">Create company</div>
            <div className="mt-3 space-y-2">
              <Input
                placeholder="Company name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
              <Button onClick={handleCreateCompany} disabled={!createName.trim()}>
                Create
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold">Join company</div>
            <div className="mt-3 space-y-2">
              <Input
                placeholder="Join code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <Button onClick={handleJoinCompany} disabled={!joinCode.trim()}>
                Request access
              </Button>
            </div>
          </Card>
        </div>

        <Card className="p-4">
          <div className="text-sm font-semibold">Your companies</div>
          {loading ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : memberships.length ? (
            <div className="mt-3 space-y-3">
              {memberships.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{m.company?.name ?? "Company"}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.role} · {m.status}
                    </div>
                  </div>
                  {m.company && ["owner", "admin", "manager"].includes(m.role) ? (
                    <div className="text-xs text-muted-foreground">Join code: {m.company.join_code}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">No memberships yet.</div>
          )}
        </Card>

        <Card className="p-4">
          <div className="text-sm font-semibold">Pending approvals</div>
          {pending.length ? (
            <div className="mt-3 space-y-3">
              {pending.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{m.company?.name ?? "Company"}</div>
                    <div className="text-xs text-muted-foreground">Role: {m.role}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => approveMembership(m.id)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => denyMembership(m.id)}>
                      Deny
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">No pending requests.</div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

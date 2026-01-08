import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { toast } from "@/components/ui/use-toast";

const db = supabase as any;

type CompanyRow = {
  id: string;
  name: string;
  owner_id: string;
  join_code: string;
  plan_name: "Solo License" | "Company License";
  plan_expires_at: string | null;
};

type MembershipRow = {
  id: string;
  company_id: string;
  user_id: string;
  role: "owner" | "admin" | "manager" | "member";
  status: "pending" | "active" | "blocked";
  company: CompanyRow | null;
};

export function CompaniesContent() {
  const { user } = useAuth();
  const { role } = useAdminAccess();
  const isAdmin = role === "owner" || role === "admin";
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [createName, setCreateName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [pending, setPending] = useState<MembershipRow[]>([]);
  const [inviteEmails, setInviteEmails] = useState<Record<string, string>>({});
  const [planEdits, setPlanEdits] = useState<
    Record<string, { plan_name: "Solo License" | "Company License"; plan_expires_at: string }>
  >({});

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
          .select("id,company_id,user_id,role,status,company:companies(id,name,owner_id,join_code,plan_name,plan_expires_at)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (!cancelled) {
          const rows = (data ?? []) as MembershipRow[];
          setMemberships(rows);
          const nextPlanEdits: Record<string, { plan_name: "Solo License" | "Company License"; plan_expires_at: string }> =
            {};
          rows.forEach((row) => {
            if (row.company) {
              nextPlanEdits[row.company.id] = {
                plan_name: row.company.plan_name,
                plan_expires_at: row.company.plan_expires_at || "",
              };
            }
          });
          setPlanEdits(nextPlanEdits);
        }
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
        .select("id,company_id,user_id,role,status,company:companies(id,name,owner_id,join_code,plan_name,plan_expires_at)")
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
    const email = ownerEmail.trim();
    if (!name || !user?.id) return;
    if (!isAdmin) {
      toast({ title: "Only admins can create companies." });
      return;
    }
    if (!email) {
      toast({ title: "Owner email is required." });
      return;
    }
    const { error } = await db.rpc("admin_create_company_by_email", {
      company_name: name,
      owner_email: email,
    });
    if (error) {
      toast({ title: "Create failed", description: error.message, variant: "destructive" });
      return;
    }
    setCreateName("");
    setOwnerEmail("");
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

  async function handleInviteMember(companyId: string) {
    const email = (inviteEmails[companyId] || "").trim();
    if (!email) return;
    const { error } = await db.rpc("invite_company_member_by_email", {
      target_company_id: companyId,
      target_email: email,
      target_role: "member",
    });
    if (error) {
      toast({ title: "Invite failed", description: error.message, variant: "destructive" });
      return;
    }
    setInviteEmails((prev) => ({ ...prev, [companyId]: "" }));
    toast({ title: "Invite sent" });
  }

  async function handleUpdateCompanyPlan(companyId: string) {
    if (!isAdmin) return;
    const plan = planEdits[companyId];
    if (!plan) return;
    const { error } = await db.rpc("admin_update_company_plan", {
      target_company_id: companyId,
      new_plan_name: plan.plan_name,
      new_plan_expires_at: plan.plan_expires_at ? plan.plan_expires_at : null,
    });
    if (error) {
      toast({ title: "Plan update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Company plan updated" });
  }

  return (
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
                disabled={!isAdmin}
              />
              <Input
                placeholder="Owner email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                disabled={!isAdmin}
              />
              <Button
                onClick={handleCreateCompany}
                disabled={!createName.trim() || !ownerEmail.trim() || !isAdmin}
              >
                Create
              </Button>
              {!isAdmin ? (
                <div className="text-xs text-muted-foreground">Only admins can create company accounts.</div>
              ) : null}
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
                      {m.role} | {m.status}
                    </div>
                  </div>
                  {m.company && ["owner", "admin", "manager"].includes(m.role) ? (
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-xs text-muted-foreground">Join code: {m.company.join_code}</div>
                      <div className="flex items-center gap-2">
                        <Input
                          className="h-8 w-48"
                          placeholder="Invite email"
                          value={inviteEmails[m.company.id] ?? ""}
                          onChange={(e) =>
                            setInviteEmails((prev) => ({ ...prev, [m.company!.id]: e.target.value }))
                          }
                        />
                        <Button size="sm" onClick={() => handleInviteMember(m.company!.id)}>
                          Invite
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {m.company && isAdmin ? (
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-xs text-muted-foreground">Plan settings</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          value={planEdits[m.company.id]?.plan_name ?? m.company.plan_name}
                          onChange={(event) =>
                            setPlanEdits((prev) => ({
                              ...prev,
                              [m.company!.id]: {
                                plan_name: event.target.value as "Solo License" | "Company License",
                                plan_expires_at: prev[m.company!.id]?.plan_expires_at ?? "",
                              },
                            }))
                          }
                        >
                          <option value="Solo License">Solo License</option>
                          <option value="Company License">Company License</option>
                        </select>
                        <Input
                          type="date"
                          className="h-8 w-40"
                          value={planEdits[m.company.id]?.plan_expires_at ?? m.company.plan_expires_at ?? ""}
                          onChange={(event) =>
                            setPlanEdits((prev) => ({
                              ...prev,
                              [m.company!.id]: {
                                plan_name: prev[m.company!.id]?.plan_name ?? m.company!.plan_name,
                                plan_expires_at: event.target.value,
                              },
                            }))
                          }
                        />
                        <Button size="sm" variant="outline" onClick={() => handleUpdateCompanyPlan(m.company!.id)}>
                          Save plan
                        </Button>
                      </div>
                    </div>
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
  );
}

export default function Companies() {
  return (
    <AppLayout>
      <CompaniesContent />
    </AppLayout>
  );
}

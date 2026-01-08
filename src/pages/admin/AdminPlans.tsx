import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { fetchPlans, updatePlan } from "@/services/adminService";
import { Plan } from "@/types/admin";
import { useAdminAccess } from "@/hooks/useAdminAccess";

type EditablePlan = {
  id: string;
  name: string;
  price_monthly: number;
  price_annual: number;
  currency: string;
  included_seats: number;
  entitlements_json: string;
  usage_limits_json: string;
  overage_rules_json: string;
};

const allowedPlanNames = ["Company License", "Solo License"];

export default function AdminPlans() {
  const { canEditBilling } = useAdminAccess();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EditablePlan | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await fetchPlans();
        if (!cancelled) setPlans(data);
      } catch (e: any) {
        if (!cancelled) {
          toast({ title: "Could not load plans", description: e?.message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = plans.filter((plan) => {
    if (!search.trim()) return true;
    return plan.name.toLowerCase().includes(search.trim().toLowerCase());
  });

  const openEditor = (plan: Plan) => {
    setEditing({
      id: plan.id,
      name: plan.name,
      price_monthly: plan.price_monthly,
      price_annual: plan.price_annual,
      currency: plan.currency,
      included_seats: plan.included_seats,
      entitlements_json: JSON.stringify(plan.entitlements_json || {}, null, 2),
      usage_limits_json: JSON.stringify(plan.usage_limits_json || {}, null, 2),
      overage_rules_json: JSON.stringify(plan.overage_rules_json || {}, null, 2),
    });
  };

  const savePlan = async () => {
    if (!editing) return;
    const trimmedName = editing.name.trim();
    if (!allowedPlanNames.includes(trimmedName)) {
      toast({
        title: "Invalid plan name",
        description: "Plan names must be Company or Solo License.",
        variant: "destructive",
      });
      return;
    }
    try {
      const entitlements = JSON.parse(editing.entitlements_json || "{}");
      const usageLimits = JSON.parse(editing.usage_limits_json || "{}");
      const overageRules = JSON.parse(editing.overage_rules_json || "{}");

      await updatePlan({
        planId: editing.id,
        name: trimmedName,
        priceMonthly: Number(editing.price_monthly),
        priceAnnual: Number(editing.price_annual),
        currency: editing.currency,
        includedSeats: Number(editing.included_seats),
        entitlements,
        usageLimits,
        overageRules,
      });
      toast({ title: "Plan updated" });
      const refreshed = await fetchPlans();
      setPlans(refreshed);
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="text-2xl font-semibold text-slate-900">Plans & entitlements</div>
          <div className="text-sm text-slate-500">Define pricing, limits, and feature access.</div>
        </div>
        <Input placeholder="Search plans..." value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, idx) => (
              <Skeleton key={idx} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((plan) => (
              <div key={plan.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{plan.name}</div>
                    <div className="text-xs text-slate-500">
                      ${plan.price_monthly}/mo | ${plan.price_annual}/yr | {plan.currency}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" disabled={!canEditBilling} onClick={() => openEditor(plan)}>
                    Edit
                  </Button>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                  <div>
                    <div className="font-semibold text-slate-900">Included seats</div>
                    <div>{plan.included_seats}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">Entitlements</div>
                    <div>{Object.keys(plan.entitlements_json || {}).length} keys</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">Usage limits</div>
                    <div>{Object.keys(plan.usage_limits_json || {}).length} keys</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit plan</DialogTitle>
            <DialogDescription>Update pricing, entitlements, and usage limits.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  placeholder="Plan name"
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                />
                <Input
                  placeholder="Currency"
                  value={editing.currency}
                  onChange={(event) => setEditing({ ...editing, currency: event.target.value })}
                />
                <Input
                  type="number"
                  placeholder="Monthly price"
                  value={editing.price_monthly}
                  onChange={(event) => setEditing({ ...editing, price_monthly: Number(event.target.value) })}
                />
                <Input
                  type="number"
                  placeholder="Annual price"
                  value={editing.price_annual}
                  onChange={(event) => setEditing({ ...editing, price_annual: Number(event.target.value) })}
                />
                <Input
                  type="number"
                  placeholder="Included seats"
                  value={editing.included_seats}
                  onChange={(event) => setEditing({ ...editing, included_seats: Number(event.target.value) })}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-xs uppercase text-slate-500">Entitlements JSON</div>
                  <Textarea
                    value={editing.entitlements_json}
                    onChange={(event) => setEditing({ ...editing, entitlements_json: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase text-slate-500">Usage limits JSON</div>
                  <Textarea
                    value={editing.usage_limits_json}
                    onChange={(event) => setEditing({ ...editing, usage_limits_json: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase text-slate-500">Overage rules JSON</div>
                  <Textarea
                    value={editing.overage_rules_json}
                    onChange={(event) => setEditing({ ...editing, overage_rules_json: event.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button onClick={savePlan} disabled={!canEditBilling}>
                  Save plan
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

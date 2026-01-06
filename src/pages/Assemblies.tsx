import { useEffect, useMemo, useState } from "react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useProjects } from "@/hooks/useProjects";
import { useAuth } from "@/hooks/useAuth";

const db = supabase as any;
const PROJECT_STORAGE_KEY = "aostot:assemblies:project";

type CostItemRow = {
  id: string;
  name: string;
  code: string | null;
  uom: string;
  unit_cost: number;
  category: string | null;
};

type AssemblyRow = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  uom: string;
};

type AssemblyItemRow = {
  id: string;
  cost_item_id: string;
  qty: number;
  unit_cost_override: number | null;
};

type AssemblyItem = AssemblyItemRow & {
  costItem?: CostItemRow | null;
};

export default function Assemblies() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: projects = [] } = useProjects();

  const [projectId, setProjectId] = useState<string>("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [assemblySearch, setAssemblySearch] = useState("");
  const [costItems, setCostItems] = useState<CostItemRow[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblyRow[]>([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string>("");
  const [assemblyItems, setAssemblyItems] = useState<AssemblyItem[]>([]);
  const [newCostName, setNewCostName] = useState("");
  const [newCostCategory, setNewCostCategory] = useState("");
  const [newCostUom, setNewCostUom] = useState("ea");
  const [newCostUnitCost, setNewCostUnitCost] = useState("0");
  const [newAssemblyName, setNewAssemblyName] = useState("");
  const [newAssemblyUom, setNewAssemblyUom] = useState("ea");
  const [newAssemblyDescription, setNewAssemblyDescription] = useState("");
  const [selectedCostItemId, setSelectedCostItemId] = useState("");
  const [selectedCostQty, setSelectedCostQty] = useState("1");

  useEffect(() => {
    if (!projects.length) return;
    const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
    const valid = projects.find((p) => p.id === stored);
    const next = valid ? valid.id : projects[0].id;
    setProjectId(next);
  }, [projects]);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: costRows, error: costError } = await db
          .from("cost_items")
          .select("id,name,code,uom,unit_cost,category")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true });
        if (costError) throw costError;

        const { data: asmRows, error: asmError } = await db
          .from("assemblies")
          .select("id,name,code,description,uom")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true });
        if (asmError) throw asmError;

        if (cancelled) return;
        setCostItems((costRows ?? []) as CostItemRow[]);
        setAssemblies((asmRows ?? []) as AssemblyRow[]);
        if (!selectedAssemblyId && asmRows?.length) {
          setSelectedAssemblyId(asmRows[0].id);
        }
      } catch (e: any) {
        if (cancelled) return;
        toast({
          title: "Failed to load catalogs",
          description: e?.message ?? "Could not load cost items or assemblies.",
          variant: "destructive",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedAssemblyId, toast]);

  useEffect(() => {
    if (!projectId || !selectedAssemblyId) {
      setAssemblyItems([]);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const { data: itemRows, error } = await db
          .from("assembly_items")
          .select("id,cost_item_id,qty,unit_cost_override")
          .eq("assembly_id", selectedAssemblyId)
          .order("created_at", { ascending: true });
        if (error) throw error;

        const rows = (itemRows ?? []) as AssemblyItemRow[];
        const ids = rows.map((r) => r.cost_item_id);
        let costMap = new Map<string, CostItemRow>();
        if (ids.length) {
          const { data: costRows, error: costErr } = await db
            .from("cost_items")
            .select("id,name,code,uom,unit_cost,category")
            .in("id", ids);
          if (costErr) throw costErr;
          costMap = new Map((costRows ?? []).map((c: CostItemRow) => [c.id, c]));
        }

        if (cancelled) return;
        setAssemblyItems(
          rows.map((row) => ({
            ...row,
            costItem: costMap.get(row.cost_item_id) ?? null,
          }))
        );
      } catch (e: any) {
        if (cancelled) return;
        toast({
          title: "Failed to load assembly items",
          description: e?.message ?? "Could not load assembly items.",
          variant: "destructive",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedAssemblyId, toast]);

  const filteredCostItems = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return costItems;
    return costItems.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        (c.category ?? "").toLowerCase().includes(q) ||
        (c.code ?? "").toLowerCase().includes(q)
      );
    });
  }, [catalogSearch, costItems]);

  const filteredAssemblies = useMemo(() => {
    const q = assemblySearch.trim().toLowerCase();
    if (!q) return assemblies;
    return assemblies.filter((a) => a.name.toLowerCase().includes(q) || (a.code ?? "").toLowerCase().includes(q));
  }, [assemblySearch, assemblies]);

  async function addCostItem() {
    if (!projectId || !user?.id) return;
    const name = newCostName.trim();
    if (!name) return;
    const unitCost = Number(newCostUnitCost);
    try {
      const { data, error } = await db
        .from("cost_items")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          name,
          uom: newCostUom.trim() || "ea",
          unit_cost: isFinite(unitCost) ? unitCost : 0,
          category: newCostCategory.trim() || null,
        })
        .select("id,name,code,uom,unit_cost,category")
        .single();
      if (error) throw error;
      setCostItems((prev) => [...prev, data as CostItemRow]);
      setNewCostName("");
      setNewCostUnitCost("0");
      setNewCostCategory("");
    } catch (e: any) {
      toast({
        title: "Failed to add cost item",
        description: e?.message ?? "Could not save cost item.",
        variant: "destructive",
      });
    }
  }

  async function addAssembly() {
    if (!projectId || !user?.id) return;
    const name = newAssemblyName.trim();
    if (!name) return;

    try {
      const { data, error } = await db
        .from("assemblies")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          name,
          uom: newAssemblyUom.trim() || "ea",
          description: newAssemblyDescription.trim() || null,
        })
        .select("id,name,code,description,uom")
        .single();
      if (error) throw error;
      setAssemblies((prev) => [...prev, data as AssemblyRow]);
      setNewAssemblyName("");
      setNewAssemblyDescription("");
      setSelectedAssemblyId(data.id);
    } catch (e: any) {
      toast({
        title: "Failed to add assembly",
        description: e?.message ?? "Could not save assembly.",
        variant: "destructive",
      });
    }
  }

  async function addAssemblyItem() {
    if (!selectedAssemblyId || !selectedCostItemId) return;
    const qty = Number(selectedCostQty);
    try {
      const { data, error } = await db
        .from("assembly_items")
        .insert({
          assembly_id: selectedAssemblyId,
          cost_item_id: selectedCostItemId,
          qty: isFinite(qty) ? qty : 1,
        })
        .select("id,cost_item_id,qty,unit_cost_override")
        .single();
      if (error) throw error;
      const costItem = costItems.find((c) => c.id === selectedCostItemId) ?? null;
      setAssemblyItems((prev) => [...prev, { ...(data as AssemblyItemRow), costItem }]);
      setSelectedCostItemId("");
      setSelectedCostQty("1");
    } catch (e: any) {
      toast({
        title: "Failed to add item",
        description: e?.message ?? "Could not add cost item to assembly.",
        variant: "destructive",
      });
    }
  }

  async function removeAssemblyItem(itemId: string) {
    try {
      const { error } = await db.from("assembly_items").delete().eq("id", itemId);
      if (error) throw error;
      setAssemblyItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (e: any) {
      toast({
        title: "Failed to remove item",
        description: e?.message ?? "Could not remove item.",
        variant: "destructive",
      });
    }
  }

  async function updateAssemblyItemQty(itemId: string, qty: number) {
    try {
      const { error } = await db.from("assembly_items").update({ qty }).eq("id", itemId);
      if (error) throw error;
    } catch (e: any) {
      toast({
        title: "Failed to update item",
        description: e?.message ?? "Could not update assembly item.",
        variant: "destructive",
      });
    }
  }

  const selectedAssembly = assemblies.find((a) => a.id === selectedAssemblyId) ?? null;

  return (
    <AppLayout>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold">Assemblies</div>
            <div className="text-sm text-muted-foreground">
              Cost catalog items and assemblies (Procore-style grouping).
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Cost catalog (Sub-items)</div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search catalog items"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                className="max-w-[320px]"
              />
              <Input
                placeholder="Item name"
                value={newCostName}
                onChange={(e) => setNewCostName(e.target.value)}
                className="max-w-[240px]"
              />
              <Input
                placeholder="Category"
                value={newCostCategory}
                onChange={(e) => setNewCostCategory(e.target.value)}
                className="max-w-[180px]"
              />
              <Input
                placeholder="UOM"
                value={newCostUom}
                onChange={(e) => setNewCostUom(e.target.value)}
                className="max-w-[100px]"
              />
              <Input
                placeholder="Unit cost"
                type="number"
                value={newCostUnitCost}
                onChange={(e) => setNewCostUnitCost(e.target.value)}
                className="max-w-[140px]"
              />
              <Button onClick={addCostItem}>Add cost item</Button>
            </div>
            <div className="mt-3 max-h-[360px] space-y-2 overflow-auto pr-2 text-sm">
              {filteredCostItems.length ? (
                filteredCostItems.map((c) => (
                  <div key={c.id} className="rounded-md border border-border px-3 py-2">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.category ?? "Uncategorized"} · {c.uom} · ${Number(c.unit_cost || 0).toFixed(2)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-muted-foreground">No cost items yet.</div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold">Assemblies (Cost catalog groups)</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search assemblies"
                value={assemblySearch}
                onChange={(e) => setAssemblySearch(e.target.value)}
                className="max-w-[260px]"
              />
              <Input
                placeholder="Assembly name"
                value={newAssemblyName}
                onChange={(e) => setNewAssemblyName(e.target.value)}
                className="max-w-[220px]"
              />
              <Input
                placeholder="UOM"
                value={newAssemblyUom}
                onChange={(e) => setNewAssemblyUom(e.target.value)}
                className="max-w-[100px]"
              />
              <Input
                placeholder="Description"
                value={newAssemblyDescription}
                onChange={(e) => setNewAssemblyDescription(e.target.value)}
                className="max-w-[280px]"
              />
              <Button onClick={addAssembly}>Add assembly</Button>
            </div>
            <div className="mt-3 max-h-[360px] space-y-2 overflow-auto pr-2 text-sm">
              {filteredAssemblies.length ? (
                filteredAssemblies.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedAssemblyId(a.id)}
                    className={[
                      "w-full rounded-md border px-3 py-2 text-left",
                      selectedAssemblyId === a.id ? "border-primary bg-muted/40" : "border-border",
                    ].join(" ")}
                  >
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.code ?? "—"} · {a.uom}
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-xs text-muted-foreground">No assemblies yet.</div>
              )}
            </div>
          </Card>
        </div>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Assembly builder</div>
              <div className="text-xs text-muted-foreground">
                Add cost catalog items to an assembly (Procore-style bundle).
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {selectedAssembly ? selectedAssembly.name : "Select an assembly"}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              value={selectedCostItemId}
              onChange={(e) => setSelectedCostItemId(e.target.value)}
            >
              <option value="">Select cost item</option>
              {costItems.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.uom}
                </option>
              ))}
            </select>
            <Input
              type="number"
              value={selectedCostQty}
              onChange={(e) => setSelectedCostQty(e.target.value)}
              className="max-w-[120px]"
            />
            <Button onClick={addAssemblyItem} disabled={!selectedAssemblyId || !selectedCostItemId}>
              Add to assembly
            </Button>
          </div>

          <div className="mt-3 max-h-[320px] overflow-auto border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-xs text-muted-foreground">Multiplier</th>
                  <th className="px-3 py-2 text-xs text-muted-foreground">Associated catalog item</th>
                  <th className="px-3 py-2 text-xs text-muted-foreground text-right">Unit cost</th>
                  <th className="px-3 py-2 text-xs text-muted-foreground text-right"></th>
                </tr>
              </thead>
              <tbody>
                {assemblyItems.length ? (
                  assemblyItems.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={item.qty}
                          className="h-8 w-20"
                          onChange={(e) =>
                            setAssemblyItems((prev) =>
                              prev.map((row) =>
                                row.id === item.id ? { ...row, qty: Number(e.target.value) } : row
                              )
                            )
                          }
                          onBlur={(e) => updateAssemblyItemQty(item.id, Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{item.costItem?.name ?? "Unknown item"}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.costItem?.category ?? "Uncategorized"} · {item.costItem?.uom ?? "--"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        ${Number(item.costItem?.unit_cost ?? 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => removeAssemblyItem(item.id)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={4}>
                      No items in this assembly yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

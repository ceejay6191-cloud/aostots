import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TakeoffCalibration, TakeoffGeometryRow, TakeoffItemRow, TakeoffKind } from "@/types/takeoff";
import type { DisplayUnit, Point } from "@/lib/takeoffMath";

export function useDocumentCalibration(projectId: string, documentId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["takeoff-calibration", documentId],
    enabled: !!projectId && !!documentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("takeoff_calibrations")
        .select("*")
        .eq("project_id", projectId)
        .eq("document_id", documentId)
        .is("page_number", null)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as TakeoffCalibration | null;
    },
  });

  const upsert = useMutation({
    mutationFn: async (payload: {
      meters_per_doc_px: number;
      display_unit: DisplayUnit;
      label?: string | null;
      owner_id: string;
    }) => {
      if (!documentId) throw new Error("Missing documentId");
      const row = {
        project_id: projectId,
        document_id: documentId,
        page_number: null,
        owner_id: payload.owner_id,
        meters_per_doc_px: payload.meters_per_doc_px,
        display_unit: payload.display_unit,
        label: payload.label ?? null,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("takeoff_calibrations")
        .upsert(row, { onConflict: "document_id,page_number" })
        .select("*")
        .single();

      if (error) throw error;
      return data as TakeoffCalibration;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["takeoff-calibration", documentId] });
    },
  });

  const clear = useMutation({
    mutationFn: async () => {
      if (!documentId) return;
      const { error } = await supabase
        .from("takeoff_calibrations")
        .delete()
        .eq("project_id", projectId)
        .eq("document_id", documentId)
        .is("page_number", null);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["takeoff-calibration", documentId] });
    },
  });

  return { query, upsert, clear };
}

export function useTakeoffPageItems(projectId: string, documentId: string | null, pageNumber: number) {
  const query = useQuery({
    queryKey: ["takeoff-items", documentId, pageNumber],
    enabled: !!projectId && !!documentId && pageNumber > 0,
    queryFn: async () => {
      if (!documentId) return [];
      const { data: items, error } = await supabase
        .from("takeoff_items")
        .select("*")
        .eq("project_id", projectId)
        .eq("document_id", documentId)
        .eq("page_number", pageNumber)
        .order("created_at", { ascending: true });

      if (error) throw error;
      const rows = (items ?? []) as TakeoffItemRow[];
      if (!rows.length) return [];

      const ids = rows.map((r) => r.id);
      const { data: geoms, error: gerr } = await supabase
        .from("takeoff_geometries")
        .select("*")
        .in("takeoff_item_id", ids);

      if (gerr) throw gerr;
      const byItem = new Map<string, TakeoffGeometryRow>();
      for (const g of (geoms ?? []) as TakeoffGeometryRow[]) byItem.set(g.takeoff_item_id, g);

      return rows.map((r) => ({ item: r, geom: byItem.get(r.id) ?? null }));
    },
  });

  return query;
}

export function useCreateTakeoffItem() {
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: async (payload: {
      project_id: string;
      document_id: string;
      page_number: number;
      owner_id: string;
      kind: TakeoffKind;
      layer_id?: string | null;
      name?: string | null;
      quantity?: number | null;
      uom?: string | null;
      meta?: any;
      geom_type: "point" | "polyline" | "polygon";
      points: Point[];
    }) => {
      const { data: item, error } = await supabase
        .from("takeoff_items")
        .insert({
          project_id: payload.project_id,
          document_id: payload.document_id,
          page_number: payload.page_number,
          owner_id: payload.owner_id,
          kind: payload.kind,
          layer_id: payload.layer_id ?? null,
          name: payload.name ?? null,
          quantity: payload.quantity ?? null,
          uom: payload.uom ?? null,
          meta: payload.meta ?? {},
        })
        .select("*")
        .single();

      if (error) throw error;

      const { error: gerr } = await supabase.from("takeoff_geometries").insert({
        takeoff_item_id: (item as any).id,
        geom_type: payload.geom_type,
        points: payload.points,
      });

      if (gerr) throw gerr;

      return item as TakeoffItemRow;
    },
    onSuccess: async (_item, vars) => {
      await qc.invalidateQueries({ queryKey: ["takeoff-items", vars.document_id, vars.page_number] });
    },
  });

  return mut;
}

export function useDeleteTakeoffItem(projectId: string, documentId: string | null, pageNumber: number) {
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("takeoff_items")
        .delete()
        .eq("project_id", projectId)
        .eq("id", itemId);

      if (error) throw error;
    },
    onSuccess: async () => {
      if (!documentId) return;
      await qc.invalidateQueries({ queryKey: ["takeoff-items", documentId, pageNumber] });
    },
  });

  return mut;
}

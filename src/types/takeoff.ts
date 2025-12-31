import type { DisplayUnit, Point } from "@/lib/takeoffMath";

export type TakeoffKind =
  | "count"
  | "measure"
  | "line"
  | "area"
  | "auto_count"
  | "auto_line"
  | "auto_area";

export type TakeoffLayer = {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  default_uom: string;
  kind_constraint: string | null;
  created_at: string;
  updated_at: string;
};

export type TakeoffCalibration = {
  id: string;
  project_id: string;
  document_id: string;
  page_number: number | null;
  owner_id: string;
  meters_per_doc_px: number;
  display_unit: DisplayUnit;
  label: string | null;
  created_at: string;
  updated_at: string;
};

export type TakeoffItemRow = {
  id: string;
  project_id: string;
  document_id: string;
  page_number: number;
  owner_id: string;
  kind: TakeoffKind;
  layer_id: string | null;
  name: string | null;
  quantity: number | null;
  uom: string | null;
  meta: any;
  created_at: string;
  updated_at: string;
};

export type TakeoffGeometryRow = {
  id: string;
  takeoff_item_id: string;
  geom_type: "point" | "polyline" | "polygon";
  points: Point[];
  bbox: any | null;
  created_at: string;
  updated_at: string;
};

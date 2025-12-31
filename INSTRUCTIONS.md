# AOSTOT Module Bundle (Takeoff + Estimating + Proposal + Scan)

This bundle includes:
- `src/` (updated)
- `supabase/migrations/` (new tables)

## 1) Replace your `src/` folder
1. Backup your current `src/`
2. Replace it with the `src/` folder from this zip

## 2) Apply Supabase migration
Copy the file under:
`supabase/migrations/20251230120000_takeoff_estimating_proposal_scan.sql`

Into your project’s `supabase/migrations/` folder, then run your normal migration workflow.

### If you are using Supabase CLI
- `supabase db push` (or your standard command)

### If you are using Supabase Dashboard SQL editor
- Paste the SQL file and run it.

> Note: This migration does NOT include RLS policies because access models differ.
> If you already use RLS, add policies consistent with your existing `projects` / `project_documents` rules.

## 3) Routes
Added routes:
- `/projects/:projectId/takeoff`
- `/projects/:projectId/estimating`
- `/projects/:projectId/proposal`
- `/projects/:projectId/scan`

ProjectDetails tabs embed these modules directly as well.

## 4) What is included (v1 scope)
### Takeoff
- Calibrate scale (no browser prompt; uses dialog)
- Pan / zoom / rotate / fit
- Count, Line, Area, Measure
- Saves takeoff items per page to Supabase tables

### Estimating
- Spreadsheet v1 (editable rows)
- Manual quantities
- Optional linking to takeoff totals by kind (v1)

### Proposal
- Template editor (title/intro/scope/terms)
- Version snapshots
- Print → Save as PDF

### Scan
- Pipeline foundation
- Prototype scan generates detections (placeholder)
- JSON import endpoint in UI for your inference service results

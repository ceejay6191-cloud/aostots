import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";

// PDF.js (Vite-friendly worker config)
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type DocumentRow = {
  id: string;
  project_id: string;
  owner_id: string;
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type PageRow = {
  id: string;
  document_id: string;
  project_id: string;
  owner_id: string;
  page_number: number;
  page_name: string | null;
  width_px: number | null;
  height_px: number | null;
  rotation: number;
  created_at: string;
  updated_at: string;
};

function formatBytes(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function PdfCanvasViewer({
  url,
  pageNumber,
  scale,
  rotation,
  onError,
}: {
  url: string;
  pageNumber: number;
  scale: number;
  rotation: number; // degrees, 0/90/180/270
  onError?: (msg: string) => void;
}) {
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!url || pageNumber < 1) return;
      setRendering(true);
      try {
        const pdf = await getDocument(url).promise;
        const page = await pdf.getPage(pageNumber);

        const viewport = page.getViewport({ scale, rotation });
        const canvas = document.getElementById("pdf-canvas") as HTMLCanvasElement | null;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;

        if (cancelled) return;
      } catch (e: any) {
        if (!cancelled) onError?.(e?.message ?? "Failed to render PDF page.");
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, pageNumber, scale, rotation, onError]);

  return (
    <div className="space-y-2">
      {rendering ? <div className="text-xs text-muted-foreground">Rendering…</div> : null}
      <canvas id="pdf-canvas" className="max-w-full rounded border" />
    </div>
  );
}

export default function ProjectDocumentPages() {
  const { projectId, documentId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [busyCreatingPages, setBusyCreatingPages] = useState(false);

  // Viewer state (B1)
  const [signedUrl, setSignedUrl] = useState<string>("");
  const [viewPage, setViewPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1.25);
  const [viewerRotation, setViewerRotation] = useState<number>(0); // 0/90/180/270

  // Inline page name editing (B2 polish)
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});

  const { data: authUser } = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user;
    },
  });

  const uid = authUser?.id;

  const { data: doc, isLoading: docLoading, error: docError } = useQuery({
    queryKey: ["project-document", documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_documents")
        .select("id,project_id,owner_id,bucket,path,file_name,mime_type,size_bytes,created_at")
        .eq("id", documentId)
        .single();

      if (error) throw error;
      return data as DocumentRow;
    },
  });

  // Basic route validation
  useEffect(() => {
    if (!doc || !projectId) return;
    if (doc.project_id !== projectId) {
      toast({
        title: "Invalid link",
        description: "That document does not belong to this project.",
        variant: "destructive",
      });
      navigate(`/projects/${projectId}`);
    }
  }, [doc, projectId, navigate]);

  const { data: pages, isLoading: pagesLoading } = useQuery({
    queryKey: ["document-pages", documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_pages")
        .select(
          "id,document_id,project_id,owner_id,page_number,page_name,width_px,height_px,rotation,created_at,updated_at"
        )
        .eq("document_id", documentId)
        .order("page_number", { ascending: true });

      if (error) throw error;
      return (data ?? []) as PageRow[];
    },
  });

  const pageCount = useMemo(() => pages?.length ?? 0, [pages]);

  async function getSignedPdfUrl(d: DocumentRow) {
    const { data, error } = await supabase.storage.from(d.bucket).createSignedUrl(d.path, 60 * 10);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("No signed URL returned.");
    return data.signedUrl;
  }

  // Prepare signed URL for the viewer once doc loads
  useEffect(() => {
    (async () => {
      if (!doc) return;
      try {
        const url = await getSignedPdfUrl(doc);
        setSignedUrl(url);
      } catch (e: any) {
        toast({
          title: "Failed to prepare viewer",
          description: e?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  async function ensurePagesExist() {
    if (!doc || !uid || !projectId) return;

    setBusyCreatingPages(true);
    try {
      const url = signedUrl || (await getSignedPdfUrl(doc));
      if (!signedUrl) setSignedUrl(url);

      // Read the PDF to get numPages
      const pdf = await getDocument(url).promise;
      const numPages = pdf.numPages;

      // If pages already exist and match, do nothing
      if ((pages?.length ?? 0) === numPages) {
        toast({ title: "Pages already created", description: `Detected ${numPages} pages.` });
        return;
      }

      const inserts = Array.from({ length: numPages }, (_, i) => ({
        document_id: doc.id,
        project_id: projectId,
        owner_id: uid,
        page_number: i + 1,
        page_name: null,
        width_px: null,
        height_px: null,
        rotation: 0,
      }));

      // NOTE: keep only onConflict - avoid ignoreDuplicates which may vary by client version
      const { error } = await supabase
        .from("document_pages")
        .upsert(inserts, { onConflict: "document_id,page_number" });

      if (error) throw error;

      toast({ title: "Pages created", description: `Detected and saved ${numPages} pages.` });
      await qc.invalidateQueries({ queryKey: ["document-pages", documentId] });

      // ensure viewer page stays valid
      setViewPage((p) => Math.min(Math.max(1, p), numPages));
    } catch (e: any) {
      toast({
        title: "Failed to create pages",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyCreatingPages(false);
    }
  }

  // Auto-create pages once doc is loaded (and pages are empty)
  useEffect(() => {
    if (!doc || !uid) return;
    if (pagesLoading) return;
    if ((pages?.length ?? 0) > 0) return;
    void ensurePagesExist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, uid, pagesLoading]);

  // Initialize drafts whenever pages load/refresh
  useEffect(() => {
    if (!pages) return;
    setDraftNames((prev) => {
      const next = { ...prev };
      for (const p of pages) {
        if (next[p.id] === undefined) next[p.id] = p.page_name ?? "";
      }
      return next;
    });
  }, [pages]);

  const savePageNameMutation = useMutation({
    mutationFn: async (payload: { pageId: string; pageName: string }) => {
      const { error } = await supabase
        .from("document_pages")
        .update({ page_name: payload.pageName.trim() || null })
        .eq("id", payload.pageId);

      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["document-pages", documentId] });
      toast({ title: "Saved", description: "Page name updated." });
    },
    onError: (e: any) => {
      toast({
        title: "Save failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const totalPdfPages = useMemo(() => {
    // If you want, we can store total pages in doc metadata later.
    // For now, treat DB pages count as authoritative.
    return pageCount;
  }, [pageCount]);

  if (docLoading) {
    return (
      <AppLayout>
        <Card className="p-6">Loading document…</Card>
      </AppLayout>
    );
  }

  if (docError || !doc) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold">Document not found</div>
            <Button variant="outline" onClick={() => navigate(`/projects/${projectId}`)}>
              Back
            </Button>
          </div>
          <Card className="p-6 text-sm text-muted-foreground">
            {String((docError as any)?.message ?? "No record returned.")}
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-2xl font-bold">Document Pages</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{doc.file_name}</Badge>
              <span>•</span>
              <span>{formatBytes(doc.size_bytes)}</span>
              <span>•</span>
              <span>{pageCount} pages in DB</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/projects/${projectId}`)}>
              Back to Project
            </Button>
            <Button variant="outline" onClick={() => void ensurePagesExist()} disabled={busyCreatingPages}>
              {busyCreatingPages ? "Scanning PDF…" : "Rescan PDF"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: pages table */}
          <Card className="lg:col-span-6 p-6 space-y-4">
            <div className="text-sm text-muted-foreground">
              Rename pages to match plan sheets (e.g., “Cover Sheet”, “General Notes”, “Electrical”, “Roof”).
            </div>

            <div className="overflow-auto rounded-xl border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">#</th>
                    <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Meta</th>
                    <th className="px-4 py-3 text-xs font-semibold text-muted-foreground text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagesLoading ? (
                    <tr>
                      <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={4}>
                        Loading pages…
                      </td>
                    </tr>
                  ) : (pages?.length ?? 0) === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={4}>
                        No pages created yet. Click “Rescan PDF”.
                      </td>
                    </tr>
                  ) : (
                    pages!.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium">{p.page_number}</td>

                        <td className="px-4 py-3">
                          <Input
                            value={draftNames[p.id] ?? ""}
                            placeholder="(optional) Page name…"
                            onChange={(e) =>
                              setDraftNames((prev) => ({
                                ...prev,
                                [p.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.currentTarget.blur();
                              }
                            }}
                            onBlur={() => {
                              const next = (draftNames[p.id] ?? "").trim();
                              const current = (p.page_name ?? "").trim();
                              if (next === current) return;
                              savePageNameMutation.mutate({ pageId: p.id, pageName: next });
                            }}
                          />
                          <div className="mt-1 text-xs text-muted-foreground">
                            {p.page_name ? "Saved" : "Not saved yet"}
                          </div>
                        </td>

                        <td className="px-4 py-3 text-muted-foreground">
                          {p.width_px && p.height_px ? `${p.width_px}×${p.height_px}` : "—"}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setViewPage(p.page_number)}
                            >
                              Open
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Right: viewer (B1 completion) */}
          <Card className="lg:col-span-6 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Viewer</div>
                <div className="text-xs text-muted-foreground">
                  {signedUrl ? `Page ${viewPage}${totalPdfPages ? ` of ${totalPdfPages}` : ""}` : "Preparing…"}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.1).toFixed(2))))}
                >
                  Zoom -
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.1).toFixed(2))))}
                >
                  Zoom +
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewerRotation((r) => (r + 90) % 360)}
                >
                  Rotate
                </Button>
              </div>
            </div>

            {!signedUrl ? (
              <div className="text-sm text-muted-foreground">Preparing secure link…</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    Zoom: {zoom.toFixed(2)} • Rotation: {viewerRotation}°
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={viewPage <= 1}
                      onClick={() => setViewPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={totalPdfPages ? viewPage >= totalPdfPages : false}
                      onClick={() => setViewPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>

                <div className="overflow-auto max-h-[75vh] rounded border border-border p-3">
                  <PdfCanvasViewer
                    url={signedUrl}
                    pageNumber={viewPage}
                    scale={zoom}
                    rotation={viewerRotation}
                    onError={(msg) =>
                      toast({
                        title: "Viewer error",
                        description: msg,
                        variant: "destructive",
                      })
                    }
                  />
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

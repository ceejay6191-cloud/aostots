// src/lib/documentKind.ts
export type DocumentKind = "pdf" | "image" | "dwg" | "unknown";

function extFromName(name: string) {
  const n = (name || "").toLowerCase().trim();
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i + 1) : "";
}

export function detectDocumentKind(doc: { file_name: string; mime_type?: string | null }): DocumentKind {
  const mime = (doc.mime_type || "").toLowerCase();
  const ext = extFromName(doc.file_name);

  if (mime.includes("pdf") || ext === "pdf") return "pdf";

  if (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(ext)
  ) {
    return "image";
  }

  if (
    mime.includes("dwg") ||
    mime.includes("dxf") ||
    ["dwg", "dxf", "dwf"].includes(ext)
  ) {
    return "dwg";
  }

  return "unknown";
}

export function inferMimeFromName(fileName: string): string | null {
  const ext = extFromName(fileName);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "dwg") return "application/acad";
  if (ext === "dxf") return "application/dxf";
  return null;
}

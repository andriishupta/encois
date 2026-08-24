import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isSourceServiceError,
  parseSourceScope,
  type SourceArtifactStore,
  uploadPdfKnowledgeSource,
} from "../services/source.service.js";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function errorStatus(code: string): 400 | 403 | 409 | 413 | 422 | 500 | 503 {
  if (
    code === "ARTIFACT_STORE_UNAVAILABLE" ||
    code === "PERSISTENCE_UNAVAILABLE"
  )
    return 503;
  if (code === "FORBIDDEN" || code === "SCOPE_DENIED") return 403;
  if (code === "INVALID_UPLOAD_SIZE") return 413;
  if (code.includes("CONFLICT")) return 409;
  if (code.endsWith("_FAILED")) return 500;
  return 422;
}

function sourceNameFromFile(fileName: string): string {
  const name = fileName.replace(/[\\/\u0000-\u001f\u007f]/g, " ").trim();
  return (name.replace(/\.pdf$/i, "").trim() || "Project document").slice(
    0,
    120,
  );
}

function isPdfFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function parseFormScope(value: unknown) {
  if (value === null) return undefined;
  if (typeof value !== "string") return null;
  try {
    return parseSourceScope(JSON.parse(value));
  } catch {
    return null;
  }
}

export function uploadPdfKnowledgeSourceRoute(
  artifactStore: SourceArtifactStore | undefined,
): Handler<GatewayEnv> {
  return async (context) => {
    const form = await context.req.raw.formData().catch(() => null);
    const file = form?.get("file");
    if (!isPdfFile(file)) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "A PDF file is required.",
          },
        },
        400,
      );
    }
    if (
      !file.name.toLowerCase().endsWith(".pdf") ||
      (file.type && file.type !== "application/pdf")
    ) {
      return context.json(
        {
          error: {
            code: "UNSUPPORTED_DOCUMENT_TYPE",
            message: "Only PDF uploads are supported in this MVP.",
          },
        },
        422,
      );
    }
    if (file.size === 0 || file.size > MAX_PDF_BYTES) {
      return context.json(
        {
          error: {
            code: "INVALID_UPLOAD_SIZE",
            message: "PDF uploads must be between 1 byte and 10 MiB.",
          },
        },
        413,
      );
    }

    const nameValue = form?.get("name");
    const name =
      typeof nameValue === "string" && nameValue.trim().length > 0
        ? nameValue.trim()
        : sourceNameFromFile(file.name);
    const readScope = parseFormScope(form?.get("readScope") ?? null);
    const visibilityScope = parseFormScope(
      form?.get("visibilityScope") ?? null,
    );
    if (readScope === null || visibilityScope === null) {
      return context.json(
        {
          error: {
            code: "INVALID_SOURCE_SCOPE",
            message:
              "readScope and visibilityScope must contain at least one organization unit.",
          },
        },
        400,
      );
    }

    try {
      const data = await uploadPdfKnowledgeSource(
        context.get("principal"),
        {
          name,
          fileName: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          ...(readScope ? { readScope } : {}),
          ...(visibilityScope ? { visibilityScope } : {}),
        },
        artifactStore,
      );
      return context.json({ data }, 201);
    } catch (error) {
      if (isSourceServiceError(error)) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          errorStatus(error.code),
        );
      }
      throw error;
    }
  };
}

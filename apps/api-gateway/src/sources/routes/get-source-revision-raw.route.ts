import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isSourceServiceError,
  readSourceArtifact,
  type SourceServiceOptions,
} from "../services/source.service.js";

function fileNameForHeader(value: string): string {
  return (
    Array.from(value)
      .map((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f || character === '"' ? "_" : character;
      })
      .join("")
      .trim()
      .slice(0, 240) || "source.pdf"
  );
}

export function getSourceRevisionRawRoute(
  options: SourceServiceOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    const sourceId = context.req.param("sourceId");
    const revisionId = context.req.param("revisionId");
    if (!sourceId || !revisionId)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Source and revision ids are required.",
          },
        },
        400,
      );

    try {
      const artifact = await readSourceArtifact(
        context.get("principal"),
        sourceId,
        revisionId,
        options,
      );
      if (!artifact)
        return context.json(
          {
            error: {
              code: "SOURCE_ARTIFACT_NOT_FOUND",
              message: "The raw Source file is not available.",
            },
          },
          404,
        );

      return new Response(Buffer.from(artifact.bytes), {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${fileNameForHeader(artifact.fileName)}"`,
          "Content-Length": String(artifact.bytes.byteLength),
          "Content-Type": artifact.contentType,
        },
      });
    } catch (error) {
      if (isSourceServiceError(error))
        return context.json(
          { error: { code: error.code, message: error.message } },
          error.code === "PERSISTENCE_UNAVAILABLE" ||
          error.code === "ARTIFACT_STORE_UNAVAILABLE"
            ? 503
            : error.code === "FORBIDDEN"
              ? 403
              : 422,
        );
      throw error;
    }
  };
}

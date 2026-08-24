import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type { SourceArtifactStore } from "./services/source.service.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type ArtifactStoreOptions = {
  bucketName?: string;
  projectId?: string;
  nodeEnv: string;
};

function objectKey(input: {
  organizationId: string;
  unitId: string;
  sourceId: string;
  revision: string;
}): string {
  return `organizations/${input.organizationId}/units/${input.unitId}/sources/${input.sourceId}/revisions/${input.revision}.pdf`;
}

type StoredArtifact = {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
};

function createMemoryArtifactStore(): SourceArtifactStore {
  const objects = new Map<string, StoredArtifact>();
  return {
    reference(input) {
      const key = objectKey(input);
      return { objectKey: key, artifactRef: `artifact://memory/${key}` };
    },
    async write(input) {
      if (input.bytes.length > MAX_UPLOAD_BYTES)
        throw new Error("artifact exceeds the configured upload limit");
      objects.set(input.artifactRef, {
        bytes: input.bytes.slice(),
        contentType: input.contentType,
        fileName: input.fileName,
      });
    },
    async read(input) {
      const artifact = objects.get(input.artifactRef);
      return artifact
        ? {
            bytes: artifact.bytes.slice(),
            contentType: artifact.contentType,
            fileName: artifact.fileName,
          }
        : null;
    },
    async remove(input) {
      objects.delete(input.artifactRef);
    },
  };
}

function createCloudStorageArtifactStore(
  options: Required<Pick<ArtifactStoreOptions, "bucketName">> &
    Pick<ArtifactStoreOptions, "projectId">,
): SourceArtifactStore {
  const appName = `encois-source-artifacts-${options.bucketName}`;
  const app =
    getApps().find((candidate) => candidate.name === appName) ??
    initializeApp(
      {
        credential: applicationDefault(),
        ...(options.projectId ? { projectId: options.projectId } : {}),
      },
      appName,
    );
  const bucket = getStorage(app).bucket(options.bucketName);

  return {
    reference(input) {
      const key = objectKey(input);
      return {
        objectKey: key,
        artifactRef: `gs://${options.bucketName}/${key}`,
      };
    },
    async write(input) {
      if (input.bytes.length > MAX_UPLOAD_BYTES)
        throw new Error("artifact exceeds the configured upload limit");
      await bucket.file(input.objectKey).save(Buffer.from(input.bytes), {
        resumable: false,
        metadata: {
          contentType: input.contentType,
          metadata: {
            organizationId: input.organizationId,
            sourceId: input.sourceId,
            revision: input.revision,
            fileName: input.fileName,
          },
        },
      });
    },
    async read(input) {
      const file = bucket.file(input.objectKey);
      try {
        const [[bytes], [metadata]] = await Promise.all([
          file.download(),
          file.getMetadata(),
        ]);
        return {
          bytes: new Uint8Array(bytes),
          contentType: metadata.contentType ?? undefined,
          fileName: metadata.metadata?.fileName ?? undefined,
        };
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: unknown }).code
            : undefined;
        if (status === 404) return null;
        throw error;
      }
    },
    async remove(input) {
      await bucket.file(input.objectKey).delete({ ignoreNotFound: true });
    },
  };
}

/**
 * Cloud Storage is required in production. The in-memory adapter is retained
 * for isolated tests and non-compose development only; watch mock configures
 * the Firebase Storage emulator so uploaded PDFs survive API restarts.
 */
export function createSourceArtifactStore(
  options: ArtifactStoreOptions,
): SourceArtifactStore | undefined {
  if (options.bucketName)
    return createCloudStorageArtifactStore({
      ...options,
      bucketName: options.bucketName,
    });
  if (options.nodeEnv === "development" || options.nodeEnv === "test")
    return createMemoryArtifactStore();
  return undefined;
}

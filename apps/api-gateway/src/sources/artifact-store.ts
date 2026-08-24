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
  sourceId: string;
  revision: string;
}): string {
  return `organizations/${input.organizationId}/sources/${input.sourceId}/revisions/${input.revision}.pdf`;
}

function createMemoryArtifactStore(): SourceArtifactStore {
  const objects = new Map<string, Uint8Array>();
  return {
    reference(input) {
      const key = objectKey(input);
      return { objectKey: key, artifactRef: `artifact://memory/${key}` };
    },
    async write(input) {
      if (input.bytes.length > MAX_UPLOAD_BYTES)
        throw new Error("artifact exceeds the configured upload limit");
      objects.set(input.artifactRef, input.bytes.slice());
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
    async remove(input) {
      await bucket.file(input.objectKey).delete({ ignoreNotFound: true });
    },
  };
}

/**
 * Cloud Storage is required in production. The in-memory adapter keeps local
 * UI/API development usable without pretending that local bytes are durable.
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

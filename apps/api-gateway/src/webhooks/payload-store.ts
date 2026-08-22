import { createHash } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const MAX_WEBHOOK_PAYLOAD_BYTES = 1 * 1024 * 1024;

export type WebhookPayloadReference = {
  payloadRef: string;
  objectKey: string;
};

export type WebhookPayloadStore = {
  reference(input: { organizationId: string; endpointKey: string; providerEventId: string; contentType: string }): WebhookPayloadReference;
  write(input: WebhookPayloadReference & {
    organizationId: string;
    endpointKey: string;
    providerEventId: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<void>;
};

type WebhookPayloadStoreOptions = {
  bucketName?: string;
  projectId?: string;
  nodeEnv: string;
};

function objectKey(input: { organizationId: string; endpointKey: string; providerEventId: string }): string {
  const eventHash = createHash("sha256").update(input.providerEventId).digest("hex");
  const endpoint = input.endpointKey.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 96) || "endpoint";
  return `organizations/${input.organizationId}/webhooks/${endpoint}/${eventHash}.json`;
}

function assertPayloadSize(bytes: Uint8Array): void {
  if (bytes.length === 0 || bytes.length > MAX_WEBHOOK_PAYLOAD_BYTES) throw new Error("WEBHOOK_PAYLOAD_TOO_LARGE");
}

function createMemoryWebhookPayloadStore(): WebhookPayloadStore {
  const objects = new Map<string, Uint8Array>();
  return {
    reference(input) {
      const key = objectKey(input);
      return { objectKey: key, payloadRef: `artifact://memory/${key}` };
    },
    async write(input) {
      assertPayloadSize(input.bytes);
      objects.set(input.payloadRef, input.bytes.slice());
    },
  };
}

function createCloudStorageWebhookPayloadStore(options: { bucketName: string; projectId?: string }): WebhookPayloadStore {
  const appName = `encois-webhook-payloads-${options.bucketName}`;
  const app = getApps().find((candidate) => candidate.name === appName) ?? initializeApp(
    { credential: applicationDefault(), ...(options.projectId ? { projectId: options.projectId } : {}) },
    appName,
  );
  const bucket = getStorage(app).bucket(options.bucketName);
  return {
    reference(input) {
      const key = objectKey(input);
      return { objectKey: key, payloadRef: `gs://${options.bucketName}/${key}` };
    },
    async write(input) {
      assertPayloadSize(input.bytes);
      await bucket.file(input.objectKey).save(Buffer.from(input.bytes), {
        resumable: false,
        metadata: {
          contentType: input.contentType,
          metadata: {
            organizationId: input.organizationId,
            endpointKey: input.endpointKey,
            providerEventId: input.providerEventId,
          },
        },
      });
    },
  };
}

/** Raw webhook bytes are retained outside Postgres so ingestion can replay them. */
export function createWebhookPayloadStore(options: WebhookPayloadStoreOptions): WebhookPayloadStore | undefined {
  if (options.bucketName) return createCloudStorageWebhookPayloadStore({ bucketName: options.bucketName, projectId: options.projectId });
  if (options.nodeEnv === "development" || options.nodeEnv === "test") return createMemoryWebhookPayloadStore();
  return undefined;
}

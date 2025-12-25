import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

const {
  MINIO_ENDPOINT = "http://localhost:9000",
  MINIO_REGION = "ru-mow",
  MINIO_ACCESS_KEY = "",
  MINIO_SECRET_KEY = "",
  MINIO_USE_SSL = "false",
  MINIO_FORCE_PATH_STYLE = "true",
  STORAGE_PUBLIC_ENDPOINT = process.env.MINIO_PUBLIC_ENDPOINT,
} = process.env;

const baseClientConfig = {
  region: MINIO_REGION,
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: MINIO_FORCE_PATH_STYLE === "true",
  tls: MINIO_USE_SSL === "true",
};

const createS3Client = (endpoint: string) =>
  new S3Client({
    ...baseClientConfig,
    endpoint,
  });

export const minioClient = createS3Client(MINIO_ENDPOINT);

const downloadEndpoint = (STORAGE_PUBLIC_ENDPOINT || "").trim() || MINIO_ENDPOINT;
export const downloadMinioClient = downloadEndpoint === MINIO_ENDPOINT ? minioClient : createS3Client(downloadEndpoint);

export async function minioHealthCheck() {
  await minioClient.send(new ListBucketsCommand({}));
}

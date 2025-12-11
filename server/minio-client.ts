import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

const {
  MINIO_ENDPOINT = "http://localhost:9000",
  MINIO_REGION = "ru-mow",
  MINIO_ACCESS_KEY = "",
  MINIO_SECRET_KEY = "",
  MINIO_USE_SSL = "false",
  MINIO_FORCE_PATH_STYLE = "true",
} = process.env;

export const minioClient = new S3Client({
  endpoint: MINIO_ENDPOINT,
  region: MINIO_REGION,
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: MINIO_FORCE_PATH_STYLE === "true",
  tls: MINIO_USE_SSL === "true",
});

export async function minioHealthCheck() {
  await minioClient.send(new ListBucketsCommand({}));
}

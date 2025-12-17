export type TariffLimitCatalogEntry = {
  limitKey: string;
  title: string;
  description?: string;
  defaultUnit: "tokens" | "bytes" | "minutes" | "count";
  uiGroup: "Storage" | "Objects" | "Other";
  uiOrder: number;
};

export const TARIFF_LIMIT_CATALOG: TariffLimitCatalogEntry[] = [
  {
    limitKey: "STORAGE_BYTES",
    title: "Хранилище",
    description: "Общий объём файлов (MinIO/S3)",
    defaultUnit: "bytes",
    uiGroup: "Storage",
    uiOrder: 1,
  },
  {
    limitKey: "QDRANT_BYTES",
    title: "Qdrant storage",
    description: "Объём векторного хранилища",
    defaultUnit: "bytes",
    uiGroup: "Storage",
    uiOrder: 2,
  },
  {
    limitKey: "OBJECT_SKILLS",
    title: "Навыки",
    description: "Количество skills",
    defaultUnit: "count",
    uiGroup: "Objects",
    uiOrder: 1,
  },
  {
    limitKey: "OBJECT_ACTIONS",
    title: "Действия",
    description: "Количество actions в workspace",
    defaultUnit: "count",
    uiGroup: "Objects",
    uiOrder: 2,
  },
  {
    limitKey: "OBJECT_KNOWLEDGE_BASES",
    title: "Базы знаний",
    description: "Количество knowledge bases",
    defaultUnit: "count",
    uiGroup: "Objects",
    uiOrder: 3,
  },
  {
    limitKey: "OBJECT_MEMBERS",
    title: "Участники",
    description: "Количество участников workspace",
    defaultUnit: "count",
    uiGroup: "Objects",
    uiOrder: 4,
  },
];

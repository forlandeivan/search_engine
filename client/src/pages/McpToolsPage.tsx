import { useMemo, useState } from "react";
import { Activity, Clock3, Database, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CatalogLogoBadge } from "@/components/CatalogLogoBadge";
import { cn } from "@/lib/utils";

type McpStatus = "connected" | "available" | "pilot";

type McpCategory = "Госданные" | "Финансы" | "Логистика" | "Коммерция" | "Операции" | "Коммуникации";

type McpToolItem = {
  id: string;
  name: string;
  provider: string;
  logo: string;
  description: string;
  category: McpCategory;
  status: McpStatus;
  freshnessLabel: string;
  freshnessSeconds: number;
  toolsCount: number;
  capabilities: string[];
  isRussian: boolean;
};

type CatalogLogoMeta = {
  src: string;
  wrapperClassName?: string;
  imageClassName?: string;
};

const MCP_LOGOS: Record<string, CatalogLogoMeta> = {
  "kontur-focus": {
    src: "https://s.kontur.ru/common-v2/icons-products/focus/focus-32.svg",
  },
  "fns-egrul": {
    src: "https://upload.wikimedia.org/wikipedia/commons/4/4e/Emblem_of_the_Federal_Tax_Service.svg",
  },
  rosreestr: {
    src: "https://upload.wikimedia.org/wikipedia/commons/0/00/Emblem_of_the_Federal_Service_for_State_Registration.svg",
  },
  "cbr-rates": {
    src: "https://upload.wikimedia.org/wikipedia/commons/7/77/CBRF_logo.svg",
  },
  "moex-iss": {
    src: "https://upload.wikimedia.org/wikipedia/commons/7/72/Moscow_Exchange_Logo.svg",
  },
  "cdek-tracking": {
    src: "https://logo-teka.com/wp-content/uploads/2025/06/cdek-logo.svg",
  },
  "russian-post": {
    src: "https://upload.wikimedia.org/wikipedia/commons/9/99/Russian_Post.svg",
  },
  "ozon-seller": {
    src: "https://logo-teka.com/wp-content/uploads/2025/06/ozon-icon-logo.svg",
  },
  "wb-seller": {
    src: "https://upload.wikimedia.org/wikipedia/commons/4/41/Wildberries_2023_Pink.svg",
  },
  dadata: {
    src: "https://dadata.ru/img/dadata-logo.svg",
  },
  "yandex-metrika": {
    src: "https://upload.wikimedia.org/wikipedia/commons/8/83/Yandex_Metrica_icon.svg",
  },
  "1c-erp-live": {
    src: "https://upload.wikimedia.org/wikipedia/commons/9/93/1C_Company_logo.svg",
  },
  "moysklad-live": {
    src: "https://www.moysklad.ru/includes/logo/logo.svg",
  },
  "vk-teams-presence": {
    src: "https://upload.wikimedia.org/wikipedia/commons/c/c9/VK_icons_logo_vk_teams_outline_20.svg",
  },
  "telegram-updates": {
    src: "https://upload.wikimedia.org/wikipedia/commons/8/83/Telegram_2019_Logo.svg",
  },
};

const MCP_STATUS_META: Record<
  McpStatus,
  {
    label: string;
    actionLabel: string;
    actionVariant: "default" | "secondary" | "outline";
    badgeClassName: string;
  }
> = {
  connected: {
    label: "Подключен",
    actionLabel: "Открыть сервер",
    actionVariant: "secondary",
    badgeClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  },
  available: {
    label: "Доступен",
    actionLabel: "Подключить",
    actionVariant: "default",
    badgeClassName: "border-blue-500/30 bg-blue-500/10 text-blue-700",
  },
  pilot: {
    label: "Пилот",
    actionLabel: "Запросить доступ",
    actionVariant: "outline",
    badgeClassName: "border-violet-500/30 bg-violet-500/10 text-violet-700",
  },
};

const MCP_CATALOG: McpToolItem[] = [
  {
    id: "kontur-focus",
    name: "Контур.Фокус",
    provider: "СКБ Контур",
    logo: "КФ",
    description: "Проверка контрагентов в реальном времени перед запуском действий и созданием заявок.",
    category: "Госданные",
    status: "connected",
    freshnessLabel: "до 20 секунд",
    freshnessSeconds: 20,
    toolsCount: 9,
    capabilities: ["Реквизиты", "Риски", "Связи компаний"],
    isRussian: true,
  },
  {
    id: "fns-egrul",
    name: "ФНС ЕГРЮЛ/ЕГРИП",
    provider: "ФНС России",
    logo: "ФНС",
    description: "Получение актуальных регистрационных данных по ИНН/ОГРН для валидации перед операциями.",
    category: "Госданные",
    status: "connected",
    freshnessLabel: "до 60 секунд",
    freshnessSeconds: 60,
    toolsCount: 6,
    capabilities: ["ИНН/КПП", "Статус юрлица", "Адрес"],
    isRussian: true,
  },
  {
    id: "rosreestr",
    name: "Росреестр",
    provider: "Росреестр",
    logo: "РР",
    description: "Запрос сведений по объектам недвижимости для риск-проверок и обработки обращений.",
    category: "Госданные",
    status: "available",
    freshnessLabel: "по расписанию",
    freshnessSeconds: 600,
    toolsCount: 4,
    capabilities: ["Кадастр", "Собственники", "Статусы объектов"],
    isRussian: true,
  },
  {
    id: "cbr-rates",
    name: "Курсы ЦБ РФ",
    provider: "Центральный банк РФ",
    logo: "ЦБ",
    description: "Актуальные валютные курсы и ключевые ставки в сценариях выставления счетов и отчетов.",
    category: "Финансы",
    status: "connected",
    freshnessLabel: "до 1 минуты",
    freshnessSeconds: 60,
    toolsCount: 5,
    capabilities: ["Курсы валют", "Ключевая ставка", "Архив значений"],
    isRussian: true,
  },
  {
    id: "moex-iss",
    name: "Мосбиржа ISS",
    provider: "MOEX",
    logo: "MX",
    description: "Потоки котировок и рыночные индикаторы для аналитических ответов и алертов.",
    category: "Финансы",
    status: "available",
    freshnessLabel: "до 15 секунд",
    freshnessSeconds: 15,
    toolsCount: 7,
    capabilities: ["Котировки", "Стакан", "Индексы"],
    isRussian: true,
  },
  {
    id: "cdek-tracking",
    name: "СДЭК Tracking",
    provider: "СДЭК",
    logo: "CDEK",
    description: "Получение трек-статусов отправлений и запуск уведомлений клиентам в тот же диалог.",
    category: "Логистика",
    status: "connected",
    freshnessLabel: "до 30 секунд",
    freshnessSeconds: 30,
    toolsCount: 8,
    capabilities: ["Трек-номер", "Статусы", "Пункты выдачи"],
    isRussian: true,
  },
  {
    id: "russian-post",
    name: "Почта России",
    provider: "Почта России",
    logo: "ПР",
    description: "Проверка состояния отправлений и передача данных в цепочку клиентской поддержки.",
    category: "Логистика",
    status: "available",
    freshnessLabel: "до 5 минут",
    freshnessSeconds: 300,
    toolsCount: 4,
    capabilities: ["Отслеживание", "История перемещений", "Сроки доставки"],
    isRussian: true,
  },
  {
    id: "ozon-seller",
    name: "Ozon Seller API",
    provider: "Ozon",
    logo: "OZ",
    description: "Остатки, заказы и отгрузки в реальном времени для автоматизации операций e-commerce.",
    category: "Коммерция",
    status: "connected",
    freshnessLabel: "до 45 секунд",
    freshnessSeconds: 45,
    toolsCount: 10,
    capabilities: ["Заказы", "Остатки", "Статусы поставок"],
    isRussian: true,
  },
  {
    id: "wb-seller",
    name: "Wildberries Seller",
    provider: "Wildberries",
    logo: "WB",
    description: "Доступ к складам, карточкам и продажам для сценариев ассистента в отделах продаж.",
    category: "Коммерция",
    status: "available",
    freshnessLabel: "до 2 минут",
    freshnessSeconds: 120,
    toolsCount: 9,
    capabilities: ["Продажи", "Остатки", "Реклама"],
    isRussian: true,
  },
  {
    id: "dadata",
    name: "DaData",
    provider: "DaData",
    logo: "DD",
    description: "Очистка и обогащение адресов, компаний и ФИО перед записью данных в ERP/CRM.",
    category: "Операции",
    status: "connected",
    freshnessLabel: "до 10 секунд",
    freshnessSeconds: 10,
    toolsCount: 7,
    capabilities: ["Адреса", "Компании", "ФИО"],
    isRussian: true,
  },
  {
    id: "yandex-metrika",
    name: "Яндекс.Метрика Realtime",
    provider: "Яндекс",
    logo: "YM",
    description: "Потоковые показатели посещаемости и событий для маркетинговых и сервисных сценариев.",
    category: "Операции",
    status: "pilot",
    freshnessLabel: "до 30 секунд",
    freshnessSeconds: 30,
    toolsCount: 5,
    capabilities: ["Онлайн-сессии", "События", "Цели"],
    isRussian: true,
  },
  {
    id: "1c-erp-live",
    name: "1С:ERP Live",
    provider: "1С",
    logo: "1C",
    description: "Получение статусов документов и операций в 1С в реальном времени через MCP-сервер.",
    category: "Операции",
    status: "available",
    freshnessLabel: "до 1 минуты",
    freshnessSeconds: 60,
    toolsCount: 11,
    capabilities: ["Документы", "Заказы", "Финансовые статусы"],
    isRussian: true,
  },
  {
    id: "moysklad-live",
    name: "МойСклад Live",
    provider: "МойСклад",
    logo: "MS",
    description: "Онлайн-остатки и движение товаров в процессах обработки заказов и ответов клиентам.",
    category: "Операции",
    status: "pilot",
    freshnessLabel: "до 40 секунд",
    freshnessSeconds: 40,
    toolsCount: 8,
    capabilities: ["Остатки", "Резервы", "Поставки"],
    isRussian: true,
  },
  {
    id: "vk-teams-presence",
    name: "VK Teams Presence",
    provider: "VK Teams",
    logo: "VK",
    description: "Статусы сотрудников и команд для маршрутизации задач по доступности в реальном времени.",
    category: "Коммуникации",
    status: "available",
    freshnessLabel: "до 20 секунд",
    freshnessSeconds: 20,
    toolsCount: 4,
    capabilities: ["Статусы", "Команды", "Назначение ответственных"],
    isRussian: true,
  },
  {
    id: "telegram-updates",
    name: "Telegram Updates",
    provider: "Telegram",
    logo: "TG",
    description: "Входящие события из ботов и каналов как источник данных для последующих действий ассистента.",
    category: "Коммуникации",
    status: "connected",
    freshnessLabel: "до 15 секунд",
    freshnessSeconds: 15,
    toolsCount: 6,
    capabilities: ["События бота", "Каналы", "Webhook-цепочки"],
    isRussian: false,
  },
];

const MCP_CATEGORIES: Array<"all" | McpCategory> = [
  "all",
  "Госданные",
  "Финансы",
  "Логистика",
  "Коммерция",
  "Операции",
  "Коммуникации",
];

type VisibilityFilter = "all" | "connected" | "russian";

const MCP_STATUS_ORDER: Record<McpStatus, number> = {
  connected: 0,
  pilot: 1,
  available: 2,
};

export default function McpToolsPage() {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | McpCategory>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");

  const connectedCount = MCP_CATALOG.filter((item) => item.status === "connected").length;
  const russianCount = MCP_CATALOG.filter((item) => item.isRussian).length;
  const toolsCount = MCP_CATALOG.reduce((acc, item) => acc + item.toolsCount, 0);

  const averageFreshnessSeconds = Math.round(
    MCP_CATALOG.filter((item) => item.status === "connected").reduce((acc, item) => acc + item.freshnessSeconds, 0) /
      Math.max(connectedCount, 1),
  );

  const filteredCatalog = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return MCP_CATALOG.filter((item) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.provider.toLowerCase().includes(normalizedQuery) ||
        item.description.toLowerCase().includes(normalizedQuery) ||
        item.capabilities.some((capability) => capability.toLowerCase().includes(normalizedQuery));

      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      const matchesVisibility =
        visibilityFilter === "all" ||
        (visibilityFilter === "connected" && item.status === "connected") ||
        (visibilityFilter === "russian" && item.isRussian);

      return matchesQuery && matchesCategory && matchesVisibility;
    }).sort((left, right) => {
      const statusDiff = MCP_STATUS_ORDER[left.status] - MCP_STATUS_ORDER[right.status];
      if (statusDiff !== 0) {
        return statusDiff;
      }
      return left.name.localeCompare(right.name, "ru");
    });
  }, [categoryFilter, query, visibilityFilter]);

  return (
    <div className="flex h-full flex-col gap-6 px-5 py-6" data-testid="page-mcp-tools">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Инструменты MCP</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Когда нужны самые актуальные данные, подключаются MCP-серверы. Это дает доступ к информации из внешних
            систем в реальном времени и позволяет сразу использовать ее в действиях ассистента.
          </p>
        </div>
        <Badge variant="secondary" className="h-fit text-xs">
          Real-time источники
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">MCP-серверов в каталоге</p>
            <p className="mt-2 text-2xl font-semibold">{MCP_CATALOG.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Подключено сейчас</p>
            <p className="mt-2 text-2xl font-semibold">{connectedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Российские источники</p>
            <p className="mt-2 text-2xl font-semibold">{russianCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Средний SLA обновления</p>
            <p className="mt-2 text-2xl font-semibold">{averageFreshnessSeconds} сек</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Database className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Внешние данные без ручных выгрузок</p>
              <p className="text-sm text-muted-foreground">
                Подключайте MCP-серверы к чату и сценариям, чтобы ассистент работал с живыми данными, а не со
                статичным экспортом.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" className="md:self-start">
            <Sparkles className="mr-2 h-4 w-4" />
            Добавить MCP-сервер
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_260px_260px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
                placeholder="Поиск по MCP-серверам, провайдеру или данным"
              />
            </div>

            <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as "all" | McpCategory)}>
              <SelectTrigger>
                <SelectValue placeholder="Категория" />
              </SelectTrigger>
              <SelectContent>
                {MCP_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category === "all" ? "Все категории" : category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={visibilityFilter}
              onValueChange={(value) => setVisibilityFilter(value as VisibilityFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Срез" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Весь каталог</SelectItem>
                <SelectItem value="connected">Только подключенные</SelectItem>
                <SelectItem value="russian">Только российские</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {filteredCatalog.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-base font-medium">Ничего не найдено</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Измените фильтры или введите более широкий поисковый запрос.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredCatalog.map((item) => {
            const statusMeta = MCP_STATUS_META[item.status];
            const logoMeta = MCP_LOGOS[item.id];

            return (
              <Card key={item.id} className="flex h-full flex-col">
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <CatalogLogoBadge
                        src={logoMeta?.src}
                        alt={`${item.name} logo`}
                        fallback={item.logo}
                        wrapperClassName={logoMeta?.wrapperClassName}
                        imageClassName={logoMeta?.imageClassName}
                      />
                      <div>
                        <CardTitle className="text-base leading-tight">{item.name}</CardTitle>
                        <CardDescription className="mt-1 text-xs">{item.provider}</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("text-[11px]", statusMeta.badgeClassName)}>
                      {statusMeta.label}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </CardHeader>

                <CardContent className="mt-auto space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-[11px]">
                      {item.category}
                    </Badge>
                    {item.capabilities.map((capability) => (
                      <Badge key={`${item.id}-${capability}`} variant="outline" className="text-[11px]">
                        {capability}
                      </Badge>
                    ))}
                    {item.isRussian ? (
                      <Badge variant="outline" className="text-[11px]">
                        RU
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" />
                      <span>{item.freshnessLabel}</span>
                    </div>
                    <span>{item.toolsCount} инструментов</span>
                  </div>

                  <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5" />
                      <span>Данные приходят в реальном времени и доступны сразу в сценариях ассистента.</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant={statusMeta.actionVariant} size="sm" className="flex-1">
                      {statusMeta.actionLabel}
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      Конфигурация
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-2 p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-foreground" />
            <span>
              Все подключения работают через scoped-доступ и журналируются для аудита действий в рабочем пространстве.
            </span>
          </div>
          <span className="font-medium text-foreground">{toolsCount} инструментов в каталоге</span>
        </CardContent>
      </Card>
    </div>
  );
}

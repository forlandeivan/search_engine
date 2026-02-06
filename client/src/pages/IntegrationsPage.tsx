import { useMemo, useState } from "react";
import { Search, Sparkles, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CatalogLogoBadge } from "@/components/CatalogLogoBadge";
import { cn } from "@/lib/utils";

type IntegrationStatus = "installed" | "available" | "requires_setup" | "beta";

type IntegrationCategory =
  | "Коммуникации"
  | "CRM и продажи"
  | "Документы и ЭДО"
  | "Платежи"
  | "Сервисы и операции";

type IntegrationItem = {
  id: string;
  name: string;
  vendor: string;
  logo: string;
  description: string;
  category: IntegrationCategory;
  tags: string[];
  status: IntegrationStatus;
  actionsCount: number;
  isRussian: boolean;
};

type CatalogLogoMeta = {
  src: string;
  wrapperClassName?: string;
  imageClassName?: string;
};

const INTEGRATION_LOGOS: Record<string, CatalogLogoMeta> = {
  max: {
    src: "https://upload.wikimedia.org/wikipedia/commons/9/9d/Max_%28app%29_logo.svg",
  },
  "vk-teams": {
    src: "https://upload.wikimedia.org/wikipedia/commons/c/c9/VK_icons_logo_vk_teams_outline_20.svg",
  },
  telegram: {
    src: "https://upload.wikimedia.org/wikipedia/commons/8/83/Telegram_2019_Logo.svg",
  },
  bitrix24: {
    src: "https://upload.wikimedia.org/wikipedia/commons/c/ce/Bitrix24-logo-ru.svg",
  },
  amocrm: {
    src: "https://www.amocrm.ru/static/assets/svg/amo.svg",
    wrapperClassName: "border-[#2e8de4]/45 bg-[#2e8de4] text-white",
  },
  kaiten: {
    src: "https://kaiten.ru/assets/img/logo.svg",
  },
  "1c-docflow": {
    src: "https://upload.wikimedia.org/wikipedia/commons/9/93/1C_Company_logo.svg",
  },
  "kontur-diadoc": {
    src: "https://s.kontur.ru/common-v2/icons-products/diadoc/diadoc-32.svg",
  },
  "kontur-edi": {
    src: "https://s.kontur.ru/common-v2/icons-products/edi/edi-32.svg",
  },
  sbis: {
    src: "https://saby.ru/cdn/SbisRuCDN/1.0.7/favicons/icon.svg",
  },
  yookassa: {
    src: "https://upload.wikimedia.org/wikipedia/commons/2/2e/%D0%AEKassa_logo.svg",
  },
  robokassa: {
    src: "https://robokassa.com/local/templates/robokassa/images/logo.svg",
  },
  moysklad: {
    src: "https://www.moysklad.ru/includes/logo/logo.svg",
  },
  "yandex-tracker": {
    src: "https://upload.wikimedia.org/wikipedia/commons/f/f3/Logo_Yandex_Tracker_2021.svg",
  },
  tilda: {
    src: "https://static.tildacdn.com/tild6263-3432-4261-a435-306131333330/logo.svg",
  },
};

const STATUS_META: Record<
  IntegrationStatus,
  {
    label: string;
    badgeClassName: string;
  }
> = {
  installed: {
    label: "Установлено",
    badgeClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  },
  available: {
    label: "Готово к установке",
    badgeClassName: "border-blue-500/30 bg-blue-500/10 text-blue-700",
  },
  requires_setup: {
    label: "Требуется настройка",
    badgeClassName: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  },
  beta: {
    label: "Бета-доступ",
    badgeClassName: "border-violet-500/30 bg-violet-500/10 text-violet-700",
  },
};

const INTEGRATION_CATALOG: IntegrationItem[] = [
  {
    id: "max",
    name: "MAX",
    vendor: "VK",
    logo: "MAX",
    description: "Передача заявок из диалога в рабочие чаты команды и запуск согласований по ответу ассистента.",
    category: "Коммуникации",
    tags: ["Чаты", "Оповещения"],
    status: "requires_setup",
    actionsCount: 9,
    isRussian: true,
  },
  {
    id: "vk-teams",
    name: "VK Teams",
    vendor: "VK",
    logo: "VK",
    description: "Создание задач, уведомлений и маршрутных карточек прямо после ответа ассистента в чатах компании.",
    category: "Коммуникации",
    tags: ["Задачи", "Согласования"],
    status: "installed",
    actionsCount: 11,
    isRussian: true,
  },
  {
    id: "telegram",
    name: "Telegram",
    vendor: "Telegram",
    logo: "TG",
    description: "Отправка итогов диалога, статусов заявок и автоматических напоминаний в внешние и внутренние каналы.",
    category: "Коммуникации",
    tags: ["Боты", "Каналы"],
    status: "installed",
    actionsCount: 8,
    isRussian: false,
  },
  {
    id: "bitrix24",
    name: "Битрикс24",
    vendor: "Битрикс",
    logo: "B24",
    description: "Создание лидов и сделок, постановка задач и запуск бизнес-процессов в CRM после каждой сессии.",
    category: "CRM и продажи",
    tags: ["CRM", "Лиды"],
    status: "installed",
    actionsCount: 14,
    isRussian: true,
  },
  {
    id: "amocrm",
    name: "amoCRM",
    vendor: "amoCRM",
    logo: "AMO",
    description: "Автосоздание карточек клиента и фиксация итогов переговоров в воронке отдела продаж.",
    category: "CRM и продажи",
    tags: ["CRM", "Сделки"],
    status: "available",
    actionsCount: 10,
    isRussian: true,
  },
  {
    id: "kaiten",
    name: "Kaiten",
    vendor: "Kaiten",
    logo: "KT",
    description: "Постановка задач в доски команд и запуск регламентов обработки обращений из ответов ассистента.",
    category: "Сервисы и операции",
    tags: ["Kanban", "Операции"],
    status: "available",
    actionsCount: 7,
    isRussian: true,
  },
  {
    id: "1c-docflow",
    name: "1С:Документооборот",
    vendor: "1С",
    logo: "1C",
    description: "Формирование внутренних поручений, регистрация документов и маршрутизация по цепочке согласования.",
    category: "Документы и ЭДО",
    tags: ["1С", "Документы"],
    status: "requires_setup",
    actionsCount: 12,
    isRussian: true,
  },
  {
    id: "kontur-diadoc",
    name: "Контур.Диадок",
    vendor: "СКБ Контур",
    logo: "КД",
    description: "Подготовка и отправка электронных документов клиентам с автоматическим контролем статусов.",
    category: "Документы и ЭДО",
    tags: ["ЭДО", "Счета"],
    status: "installed",
    actionsCount: 10,
    isRussian: true,
  },
  {
    id: "kontur-edi",
    name: "Контур.EDI",
    vendor: "СКБ Контур",
    logo: "EDI",
    description: "Автоматическая передача заказов и закрывающих документов по цепочке поставок.",
    category: "Документы и ЭДО",
    tags: ["EDI", "Логистика"],
    status: "beta",
    actionsCount: 6,
    isRussian: true,
  },
  {
    id: "sbis",
    name: "СБИС",
    vendor: "Тензор",
    logo: "СБ",
    description: "Обмен первичными документами и контроль статусов контрагентов через единый рабочий контур.",
    category: "Документы и ЭДО",
    tags: ["ЭДО", "Контрагенты"],
    status: "requires_setup",
    actionsCount: 9,
    isRussian: true,
  },
  {
    id: "yookassa",
    name: "ЮKassa",
    vendor: "ЮMoney",
    logo: "ЮК",
    description: "Создание платежей и отправка ссылок на оплату в один клик из сценариев ассистента.",
    category: "Платежи",
    tags: ["Платежи", "Ссылки"],
    status: "installed",
    actionsCount: 8,
    isRussian: true,
  },
  {
    id: "robokassa",
    name: "Robokassa",
    vendor: "Robokassa",
    logo: "RK",
    description: "Прием оплат и обновление статуса сделки в CRM после подтверждения транзакции.",
    category: "Платежи",
    tags: ["Платежи", "Webhook"],
    status: "available",
    actionsCount: 5,
    isRussian: true,
  },
  {
    id: "moysklad",
    name: "МойСклад",
    vendor: "МойСклад",
    logo: "MS",
    description: "Резервирование товаров, проверка остатков и передача заказов в складской контур.",
    category: "Сервисы и операции",
    tags: ["Склад", "Остатки"],
    status: "beta",
    actionsCount: 7,
    isRussian: true,
  },
  {
    id: "yandex-tracker",
    name: "Яндекс Трекер",
    vendor: "Яндекс 360",
    logo: "YT",
    description: "Создание тикетов поддержки и постановка задач командам с привязкой к истории переписки.",
    category: "Сервисы и операции",
    tags: ["Тикеты", "Поддержка"],
    status: "available",
    actionsCount: 9,
    isRussian: true,
  },
  {
    id: "tilda",
    name: "Tilda",
    vendor: "Tilda",
    logo: "TD",
    description: "Передача заявок с лендингов в цепочки обработки и запуск сервисных сценариев no-code.",
    category: "CRM и продажи",
    tags: ["Формы", "Лендинги"],
    status: "available",
    actionsCount: 6,
    isRussian: true,
  },
];

const CATEGORY_OPTIONS: Array<"all" | IntegrationCategory> = [
  "all",
  "Коммуникации",
  "CRM и продажи",
  "Документы и ЭДО",
  "Платежи",
  "Сервисы и операции",
];

type VisibilityFilter = "all" | "installed" | "russian";

const STATUS_SORT_ORDER: Record<IntegrationStatus, number> = {
  installed: 0,
  requires_setup: 1,
  beta: 2,
  available: 3,
};

export default function IntegrationsPage() {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | IntegrationCategory>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [activeToggles, setActiveToggles] = useState<Record<string, boolean>>({});

  const installedCount = INTEGRATION_CATALOG.filter((item) => item.status === "installed").length;
  const requiresSetupCount = INTEGRATION_CATALOG.filter((item) => item.status === "requires_setup").length;
  const totalScenarios = INTEGRATION_CATALOG.reduce((acc, item) => acc + item.actionsCount, 0);

  const filteredCatalog = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return INTEGRATION_CATALOG.filter((item) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.vendor.toLowerCase().includes(normalizedQuery) ||
        item.description.toLowerCase().includes(normalizedQuery) ||
        item.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));

      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      const matchesVisibility =
        visibilityFilter === "all" ||
        (visibilityFilter === "installed" && item.status === "installed") ||
        (visibilityFilter === "russian" && item.isRussian);

      return matchesQuery && matchesCategory && matchesVisibility;
    }).sort((left, right) => {
      const statusDiff = STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status];
      if (statusDiff !== 0) {
        return statusDiff;
      }
      return left.name.localeCompare(right.name, "ru");
    });
  }, [categoryFilter, query, visibilityFilter]);

  return (
    <div className="flex h-full flex-col gap-6 px-5 py-6" data-testid="page-integrations">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Интеграции</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Если после ответа важно сразу выполнить операцию в рабочей системе компании, подключаются действия:
            десятки готовых интеграций или собственные сценарии через no-code инструменты. Ассистент может создать
            заявку, запустить процесс и передать данные дальше по цепочке.
          </p>
        </div>
        <Badge variant="secondary" className="h-fit text-xs">
          Каталог действий
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Интеграций в каталоге</p>
            <p className="mt-2 text-2xl font-semibold">{INTEGRATION_CATALOG.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Уже установлено</p>
            <p className="mt-2 text-2xl font-semibold">{installedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Требуют настройки</p>
            <p className="mt-2 text-2xl font-semibold">{requiresSetupCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Готовые сценарии</p>
            <p className="mt-2 text-2xl font-semibold">{totalScenarios}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Workflow className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Собственные сценарии без кода</p>
              <p className="text-sm text-muted-foreground">
                Используйте no-code конструктор, чтобы собрать цепочки под ваши регламенты и подключить их к ответам
                ассистента.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" className="md:self-start">
            <Sparkles className="mr-2 h-4 w-4" />
            Создать сценарий
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
                placeholder="Поиск по интеграциям, поставщику или сценарию"
              />
            </div>

            <Select
              value={categoryFilter}
              onValueChange={(value) => setCategoryFilter(value as "all" | IntegrationCategory)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Категория" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((category) => (
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
                <SelectItem value="installed">Только установленные</SelectItem>
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
              Попробуйте изменить фильтры или очистить поисковый запрос.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredCatalog.map((item) => {
            const statusMeta = STATUS_META[item.status];
            const logoMeta = INTEGRATION_LOGOS[item.id];
            const showActiveToggle = item.status === "installed";
            const isToggleOn = Boolean(activeToggles[item.id]);

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
                        <CardDescription className="mt-1 text-xs">{item.vendor}</CardDescription>
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
                    {item.tags.map((tag) => (
                      <Badge key={`${item.id}-${tag}`} variant="outline" className="text-[11px]">
                        {tag}
                      </Badge>
                    ))}
                    {item.isRussian ? (
                      <Badge variant="outline" className="text-[11px]">
                        RU
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.actionsCount} сценариев</span>
                    <span>{item.status === "installed" ? "Подключено" : "Можно подключить"}</span>
                  </div>
                  {showActiveToggle ? (
                    <div className={cn("flex items-center justify-between rounded-md border px-3 py-2", isToggleOn ? "border-blue-500/70 bg-blue-500/5" : "border-border/60 bg-muted/30")}>
                      <span className="text-xs font-medium text-foreground">Активен</span>
                      <Switch checked={isToggleOn} onCheckedChange={(checked) => setActiveToggles((prev) => ({ ...prev, [item.id]: checked }))} aria-label={`${item.name} активен`} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

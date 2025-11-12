import { Link, useRoute } from "wouter";

export default function ProjectDetailPage() {
  const [, params] = useRoute("/projects/:siteId");
  const siteId = params?.siteId;

  return (
    <div className="max-w-4xl mx-auto px-6 py-16 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/integrations/api" className="hover:underline">
            Интеграции
          </Link>
          <span>/</span>
          <span>Проект</span>
        </div>
        <h1 className="text-3xl font-bold">Карточка проекта</h1>
        <p className="text-muted-foreground">
          Раздел перешёл в режим только для чтения. Мы отключили запросы к /api/sites и /api/pages/:id, поэтому данные
          о краулинге и страницах не отображаются.
        </p>
      </header>

      <section className="rounded-lg border bg-card p-6 space-y-3">
        <h2 className="text-xl font-semibold">Сведения о проекте</h2>
        <p className="text-muted-foreground">
          {siteId ? `Идентификатор из URL: ${siteId}` : "Выберите проект из списка на странице интеграций."}
        </p>
        <p className="text-sm text-muted-foreground">
          Векторизация и управление страницами отключены после удаления соответствующих API. Вы можете повторно
          подключить проект позже — интерфейс останется, но без активных действий.
        </p>
      </section>

      <section className="rounded-lg border border-dashed bg-muted/40 p-6 space-y-2 text-sm text-muted-foreground">
        <p>В ближайшем обновлении появится новый сценарий работы с проектами.</p>
        <p>
          До тех пор используйте раздел «Базы знаний» для пополнения данных и управление коллекциями в пункте «Коллекции».
        </p>
      </section>
    </div>
  );
}

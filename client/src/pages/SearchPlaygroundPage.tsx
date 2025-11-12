export default function SearchPlaygroundPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold mb-4">Песочница поиска</h1>
      <p className="text-muted-foreground mb-6">
        Экспериментальный стенд временно отключён. Мы убрали обращения к API /api/search и /api/sites, чтобы не
        беспокоить удалённые сервисы. Проверьте страницу позже — сюда вернутся интерактивные сценарии.
      </p>
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Пока API недоступны, вы можете работать с базами знаний и коллекциями в других разделах. Никакие запросы не
          отправляются автоматически.
        </p>
      </div>
    </div>
  );
}

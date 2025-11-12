export default function TildaApiPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Интеграции и API</h1>
        <p className="text-muted-foreground">
          Управление сайтами и ключами временно отключено: мы удалили обращения к /api/sites. Документация и готовые
          примеры вернутся после обновления платформы.
        </p>
      </header>

      <section className="rounded-lg border bg-card p-6 space-y-3">
        <h2 className="text-xl font-semibold">Что изменилось</h2>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>API-ключи больше не отображаются и не ротируются автоматически.</li>
          <li>Список сайтов временно недоступен — он не запрашивается у сервера.</li>
          <li>Компоненты Tilda отключены, чтобы избежать ошибок после удаления /api/sites.</li>
        </ul>
      </section>

      <section className="rounded-lg border border-dashed bg-muted/40 p-6 text-sm text-muted-foreground">
        <p>
          Если нужна интеграция прямо сейчас, воспользуйтесь публичной документацией API или обратитесь к команде
          поддержки. Функциональность вернётся после релиза нового каталога сайтов.
        </p>
      </section>
    </div>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import SearchBar from "@/components/SearchBar";

export default function SearchPage() {
  const [query, setQuery] = useState("");

  const handleSearch = (value: string) => {
    setQuery(value);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold mb-2">Поисковый движок</h1>
            <p className="text-muted-foreground">
              Встроенный поиск временно недоступен. Вы всё ещё можете готовить контент в базах знаний и использовать
              поиск внутри них.
            </p>
          </div>
          <SearchBar onSearch={handleSearch} defaultValue={query} />
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        {query ? (
          <div className="mx-auto max-w-2xl space-y-4 text-center">
            <h2 className="text-xl font-semibold">Поиск отключён</h2>
            <p className="text-muted-foreground">
              Мы не обращаемся к API /api/search и не сохраняем ваш запрос «{query}». Обновите страницу позже, чтобы
              проверить статус поиска.
            </p>
            <p className="text-sm text-muted-foreground">
              Пока что можно открыть раздел {" "}
              <Link href="/knowledge" className="underline">
                «Базы знаний»
              </Link>{" "}
              и воспользоваться поиском внутри нужной базы.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 text-center text-muted-foreground">
            <p>Введите запрос — мы сохраним его локально, но не будем отправлять на сервер.</p>
            <p className="text-sm">Функция глобального поиска появится снова после обновления API.</p>
            <p className="text-sm">
              Нужна выдача прямо сейчас? Перейдите в раздел {" "}
              <Link href="/knowledge" className="underline">
                «Базы знаний»
              </Link>{" "}
              и выполните поиск внутри выбранной базы.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

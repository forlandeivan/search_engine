import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  defaultValue?: string;
}

export default function SearchBar({ onSearch, placeholder = "Поиск", defaultValue = "" }: SearchBarProps) {
  const [query, setQuery] = useState(defaultValue);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    setQuery(defaultValue);
  }, [defaultValue]);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  const triggerSearch = useCallback(() => {
    onSearch(trimmedQuery);
  }, [onSearch, trimmedQuery]);

  useEffect(() => {
    if (isComposing) return;
    const timeoutId = window.setTimeout(() => {
      triggerSearch();
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [triggerSearch, isComposing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    triggerSearch();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      triggerSearch();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative max-w-3xl mx-auto">
      <div className="flex items-center gap-2 rounded-full border-2 border-input bg-background px-4 py-2 shadow-sm focus-within:border-primary transition-colors">
        <Search className="h-5 w-5 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(e) => {
            setIsComposing(false);
            setQuery(e.currentTarget.value);
          }}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-auto border-0 bg-transparent px-0 text-lg focus-visible:ring-0 focus-visible:ring-offset-0"
          data-testid="input-search"
        />
        <Button
          type="submit"
          disabled={trimmedQuery.length === 0}
          className="ml-auto rounded-full px-6"
          data-testid="button-search"
        >
          Найти
        </Button>
      </div>
    </form>
  );
}
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Braces, FunctionSquare, ChevronRight } from "lucide-react";
import type { FieldInfo } from "@/lib/json-import-types";

interface FieldTokenPopupProps {
  fields: FieldInfo[];
  onSelect: (fieldPath: string) => void;
  onOpenFunctions: () => void;
}

export function FieldTokenPopup({
  fields,
  onSelect,
  onOpenFunctions,
}: FieldTokenPopupProps) {
  const [search, setSearch] = useState("");

  const filteredFields = useMemo(() => {
    if (!search.trim()) return fields;
    const lowerSearch = search.toLowerCase();
    return fields.filter(
      f => f.key.toLowerCase().includes(lowerSearch) ||
           f.path.toLowerCase().includes(lowerSearch)
    );
  }, [fields, search]);

  // Группировка по первому уровню вложенности
  const groupedFields = useMemo(() => {
    const groups = new Map<string, FieldInfo[]>();
    
    for (const field of filteredFields) {
      const parts = field.path.split('.');
      const group = parts.length > 1 ? parts[0] : '';
      
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(field);
    }
    
    return groups;
  }, [filteredFields]);

  return (
    <div className="flex flex-col">
      {/* Поиск */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск полей..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            autoFocus
          />
        </div>
      </div>

      {/* Список полей */}
      <ScrollArea className="h-[300px]">
        <div className="p-2">
          {Array.from(groupedFields.entries()).map(([group, groupFields]) => (
            <div key={group || 'root'} className="mb-2">
              {group && (
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {group}
                </div>
              )}
              {groupFields.map((field) => (
                <button
                  key={field.path}
                  type="button"
                  onClick={() => onSelect(field.path)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded-md hover:bg-accent"
                >
                  <Braces className="h-4 w-4 text-blue-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{field.key}</div>
                    {field.path !== field.key && (
                      <div className="text-xs text-muted-foreground truncate">
                        {field.path}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs flex-shrink-0">
                    {field.type}
                  </Badge>
                </button>
              ))}
            </div>
          ))}

          {filteredFields.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-4">
              Поля не найдены
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Кнопка для перехода к функциям */}
      <div className="p-2 border-t">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between"
          onClick={onOpenFunctions}
        >
          <span className="flex items-center gap-2">
            <FunctionSquare className="h-4 w-4 text-purple-600" />
            Функции
          </span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

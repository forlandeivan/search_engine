import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FunctionSquare, ChevronLeft } from "lucide-react";
import { EXPRESSION_FUNCTIONS, type ExpressionFunction } from "@/lib/expression-functions";

interface FunctionTokenPopupProps {
  onSelect: (functionName: string) => void;
  onBack: () => void;
}

export function FunctionTokenPopup({
  onSelect,
  onBack,
}: FunctionTokenPopupProps) {
  const categories: Array<{ id: ExpressionFunction['category']; label: string }> = [
    { id: 'generator', label: 'Генераторы' },
    { id: 'string', label: 'Строковые' },
    { id: 'date', label: 'Дата и время' },
    { id: 'math', label: 'Математические' },
  ];

  return (
    <div className="flex flex-col">
      {/* Заголовок с кнопкой назад */}
      <div className="p-2 border-b flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onBack}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-medium">Функции</span>
      </div>

      {/* Список функций */}
      <ScrollArea className="h-[300px]">
        <div className="p-2">
          {categories.map((category) => {
            const categoryFuncs = EXPRESSION_FUNCTIONS.filter(
              f => f.category === category.id
            );
            
            if (categoryFuncs.length === 0) return null;

            return (
              <div key={category.id} className="mb-3">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {category.label}
                </div>
                {categoryFuncs.map((func) => (
                  <button
                    key={func.name}
                    type="button"
                    onClick={() => onSelect(func.name)}
                    className="w-full flex items-start gap-2 px-2 py-2 text-left text-sm rounded-md hover:bg-accent"
                  >
                    <FunctionSquare className="h-4 w-4 text-purple-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">{func.name}()</span>
                        <Badge variant="outline" className="text-xs">
                          {func.returnType}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {func.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

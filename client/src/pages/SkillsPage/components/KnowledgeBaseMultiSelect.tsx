/**
 * Knowledge Base Multi-Select Component
 *
 * A multi-select dropdown for selecting knowledge bases
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { ChevronsUpDown } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { KnowledgeBaseMultiSelectProps } from "../types";

export function KnowledgeBaseMultiSelect({ value, onChange, knowledgeBases, disabled, embeddingProviderName }: KnowledgeBaseMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedBases = useMemo(() => {
    return knowledgeBases.filter((kb) => selectedSet.has(kb.id));
  }, [knowledgeBases, selectedSet]);
  const MAX_BADGES = 2;
  const visibleBadges = selectedBases.slice(0, MAX_BADGES);
  const extraBadges = selectedBases.length - visibleBadges.length;

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(value.filter((currentId) => currentId !== id));
      return;
    }
    onChange([...value, id]);
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between gap-2"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || knowledgeBases.length === 0}
            data-testid="libraries-multiselect"
          >
            {knowledgeBases.length === 0 ? (
              <span className="truncate">Нет доступных баз</span>
            ) : selectedBases.length === 0 ? (
              <span className="truncate text-muted-foreground">Выберите базы знаний</span>
            ) : (
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {visibleBadges.map((kb) => (
                  <Badge key={kb.id} variant="secondary" className="text-[11px]">
                    {kb.name}
                  </Badge>
                ))}
                {extraBadges > 0 && (
                  <Badge variant="outline" className="text-[11px] text-muted-foreground">
                    +{extraBadges}
                  </Badge>
                )}
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] p-0">
          <Command>
            <CommandInput placeholder="Поиск по названию..." />
            <CommandList>
              <CommandEmpty>Ничего не найдено</CommandEmpty>
              <CommandGroup heading="Базы знаний">
                {knowledgeBases.map((kb) => {
                  const isSelected = selectedSet.has(kb.id);
                  return (
                    <CommandItem
                      key={kb.id}
                      value={kb.name}
                      onSelect={() => toggle(kb.id)}
                      className="items-start"
                    >
                      <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                      <div className="space-y-0.5 flex-1">
                        <p className="text-sm font-medium leading-none">{kb.name}</p>
                        {kb.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{kb.description}</p>
                        )}
                        {embeddingProviderName && (
                          <p className="text-xs text-muted-foreground">
                            Провайдер эмбеддингов: <span className="font-medium">{embeddingProviderName}</span>
                          </p>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type BaseNameFormProps = {
  name: string;
  onNameChange: (name: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  disabled?: boolean;
};

export function BaseNameForm({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  disabled,
}: BaseNameFormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,12rem)_1fr] items-start gap-3">
        <Label htmlFor="create-base-name" className="pt-2">
          Название
        </Label>
        <Input
          id="create-base-name"
          placeholder="Например, База знаний по клиентской поддержке"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,12rem)_1fr] items-start gap-3">
        <Label htmlFor="create-base-description" className="pt-2">
          Описание
        </Label>
        <Textarea
          id="create-base-description"
          rows={3}
          disabled={disabled}
          placeholder="Для чего нужна база знаний и какие процессы она покрывает"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </div>
    </div>
  );
}

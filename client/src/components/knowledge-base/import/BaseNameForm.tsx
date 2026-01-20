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
      <div className="space-y-2">
        <Label htmlFor="create-base-name">Название базы знаний</Label>
        <Input
          id="create-base-name"
          placeholder="Например, База знаний по клиентской поддержке"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="create-base-description">Краткое описание</Label>
        <Textarea
          id="create-base-description"
          rows={3}
          disabled={disabled}
          placeholder="Расскажите, для чего нужна база знаний и какие процессы она покрывает"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </div>
    </div>
  );
}

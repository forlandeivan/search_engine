import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface CancelIndexingDialogProps {
  open: boolean;
  onClose: () => void;
  baseName: string;
  processedDocuments: number;
  totalDocuments: number;
  onConfirm: (deleteData: boolean) => Promise<void>;
}

export function CancelIndexingDialog({
  open,
  onClose,
  baseName,
  processedDocuments,
  totalDocuments,
  onConfirm,
}: CancelIndexingDialogProps) {
  const [deleteData, setDeleteData] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm(deleteData);
      onClose();
      setDeleteData(false);
    } catch (error) {
      // Ошибка обрабатывается в хуке
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setDeleteData(false);
    onClose();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleCancel}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Остановить индексацию?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-4">
            <p>
              Обработано <strong>{processedDocuments}</strong> из <strong>{totalDocuments}</strong> документов.
            </p>

            <div className="space-y-3 rounded-md border bg-background p-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="delete-data"
                  checked={deleteData}
                  onCheckedChange={(checked) => setDeleteData(checked === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="delete-data" className="cursor-pointer font-normal">
                    Удалить проиндексированные данные
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Если выбрано: все документы, проиндексированные в этой сессии, будут удалены из
                    поискового индекса.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Если не выбрано: {processedDocuments} документов останутся в индексе, оставшиеся{" "}
                    {totalDocuments - processedDocuments} можно будет проиндексировать позже.
                  </p>
                </div>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel} disabled={isLoading}>
            Отмена
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? "Остановка..." : "Остановить"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

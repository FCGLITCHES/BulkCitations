import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, X } from "lucide-react";

interface ErrorToastProps {
  visible: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
  variant?: "error" | "warning";
}

export default function ErrorToast({ visible, title, message, onDismiss, variant = "error" }: ErrorToastProps) {
  if (!visible) return null;

  const isWarning = variant === "warning";
  return (
    <div className="fixed inset-x-4 top-4 z-50 sm:left-auto sm:right-6 sm:top-6">
      <Card className={`shadow-lg max-w-sm ${isWarning ? "bg-amber-100 text-amber-950 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800" : "bg-destructive text-destructive-foreground"}`}>
        <CardContent className="flex items-start space-x-3 p-4">
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{title}</p>
            <p className="text-sm opacity-90 mt-1 whitespace-pre-line">{message}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className={isWarning ? "text-amber-950 hover:bg-amber-200 dark:text-amber-100 dark:hover:bg-amber-900 p-1 h-auto" : "text-destructive-foreground hover:bg-destructive/20 p-1 h-auto"}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface ProcessingStatusProps {
  visible: boolean;
  title: string;
  message: string;
}

export default function ProcessingStatus({ visible, title, message }: ProcessingStatusProps) {
  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <Card className="shadow-lg max-w-sm">
        <CardContent className="flex items-center space-x-3 p-4">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <div>
            <p className="font-medium text-foreground">{title}</p>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

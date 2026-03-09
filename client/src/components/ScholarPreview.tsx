import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Link, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import type { AuthorityData, ConfidenceResult, AuthorityStatus } from "@shared/schema";
import { Button } from "./ui/button";
import { RefreshCw } from "lucide-react";
import { useState, useRef, useCallback } from "react";

interface ScholarPreviewProps {
    confidence?: ConfidenceResult;
    authorityData?: AuthorityData;
    authorityStatus?: AuthorityStatus;
    isPro?: boolean;
    referenceId?: string;
    onRecheck?: (referenceId: string) => void;
}

function authorityStatusLabel(status: AuthorityStatus): string {
    switch (status) {
        case "cache_hit": return "Validated (cache)";
        case "fetched": return "Validated";
        case "no_match": return "No match";
        case "error": return "Error";
        case "blocked": return "Upgrade to validate";
        case "skipped": return "Validation skipped";
        default: return "";
    }
}

export function ScholarPreview({ confidence, authorityData, authorityStatus, isPro = false, referenceId, onRecheck }: ScholarPreviewProps) {
    if (!confidence) return null;

    if (!isPro) {
        return (
            <Badge
                variant="secondary"
                className="cursor-not-allowed flex items-center text-xs ml-2 opacity-50"
                title="Pro Feature"
                aria-label="Confidence score: Pro feature required"
            >
                🔒 {authorityStatus === "blocked" ? "Upgrade to validate" : "Confidence Score"}
            </Badge>
        );
    }

    // Planned bands: >=95 Authority Validated, 80-94 Partial match, <80 Needs review
    let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
    let icon = null;
    let bandLabel = "";

    if (confidence.isSuspicious || confidence.score < 50) {
        badgeVariant = "destructive";
        icon = <AlertTriangle className="w-3 h-3 mr-1" />;
        bandLabel = "Needs review";
    } else if (confidence.score >= 95) {
        badgeVariant = "default";
        icon = <CheckCircle2 className="w-3 h-3 mr-1" />;
        bandLabel = "Authority Validated";
    } else if (confidence.score >= 80) {
        badgeVariant = "secondary";
        bandLabel = "Partial match";
    } else {
        badgeVariant = "secondary";
        bandLabel = "Needs review";
    }

    const statusLabel = authorityStatus ? authorityStatusLabel(authorityStatus) : "";

    // Mobile long-press state
    const [mobileOpen, setMobileOpen] = useState(false);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleTouchStart = useCallback(() => {
        longPressTimer.current = setTimeout(() => {
            setMobileOpen(true);
        }, 600);
    }, []);

    const handleTouchEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    // Shared content for both HoverCard and mobile Dialog
    const previewContent = (
        <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center">
                Confidence Breakdown
            </h4>
            <div className="text-sm text-muted-foreground flex justify-between">
                <span>Parsing Rules:</span>
                <span>{confidence.breakdown.rules}/100</span>
            </div>

            {authorityData && (
                <>
                    <div className="text-sm text-muted-foreground flex justify-between">
                        <span>Journal Match:</span>
                        <span>{confidence.breakdown.journal || 0}/100</span>
                    </div>
                    <div className="text-sm text-muted-foreground flex justify-between">
                        <span>Fields Match:</span>
                        <span>{confidence.breakdown.fields || 0}/100</span>
                    </div>

                    <div className="mt-4 pt-4 border-t">
                        <h5 className="text-xs font-semibold mb-2 flex items-center text-primary">
                            <Link className="h-3 w-3 mr-1" />
                            Authority Record (Semantic Scholar)
                        </h5>
                        <p className="text-xs font-medium leading-tight">
                            {authorityData.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                            {authorityData.authors?.join(", ")}
                        </p>
                        <div className="flex justify-between items-center mt-2">
                            <p className="text-xs text-muted-foreground">
                                {authorityData.journal} {authorityData.year ? `(${authorityData.year})` : ''}
                            </p>
                            {authorityData.url && (
                                <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                                    <a href={authorityData.url} target="_blank" rel="noopener noreferrer" aria-label="View in Semantic Scholar">
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </Button>
                            )}
                        </div>
                    </div>
                </>
            )}

            {authorityStatus && statusLabel && (
                <div className="text-xs text-muted-foreground pt-1">
                    {statusLabel}
                </div>
            )}

            {confidence.isSuspicious && (
                <div className="mt-4 pt-4 border-t flex items-start text-destructive">
                    <AlertTriangle className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                    <p className="text-xs">
                        Warning: The authoritative metadata strongly mismatches the provided text. Proceed with caution.
                    </p>
                </div>
            )}

            {onRecheck && referenceId && (confidence.score < 95 || authorityStatus === "no_match" || authorityStatus === "error") && (
                <div className="mt-4 pt-4 border-t">
                    <Button variant="outline" size="sm" className="w-full" onClick={() => onRecheck(referenceId)}>
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Recheck
                    </Button>
                </div>
            )}
        </div>
    );

    return (
        <TooltipProvider>
            <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                    <Badge
                        variant={badgeVariant}
                        className="cursor-help flex items-center text-[10px] sm:text-xs h-6 px-2 font-normal"
                        aria-label={`Confidence: ${confidence.score}%, ${bandLabel}`}
                        tabIndex={0}
                        role="button"
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        onTouchCancel={handleTouchEnd}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMobileOpen(true); } }}
                    >
                        {icon}
                        <span className="hidden sm:inline whitespace-nowrap">{bandLabel ? `${bandLabel} (${confidence.score}%)` : `${confidence.score}% Match`}</span>
                        <span className="sm:hidden">{`${confidence.score}%`}</span>
                    </Badge>
                </TooltipTrigger>
                <TooltipContent className="w-80 p-4">
                    {previewContent}
                </TooltipContent>
            </Tooltip>

            {/* Mobile long-press Dialog fallback */}
            <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
                <DialogContent className="max-w-sm" aria-describedby="scholar-preview-desc">
                    <DialogHeader>
                        <DialogTitle>Confidence Details</DialogTitle>
                    </DialogHeader>
                    <div id="scholar-preview-desc">
                        {previewContent}
                    </div>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
}

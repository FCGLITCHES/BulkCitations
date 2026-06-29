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
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { HealthState, ConvertedReference } from "@/lib/types";
import { CONFIDENCE_THRESHOLDS } from "@shared/confidenceThresholds";

interface ScholarPreviewProps {
    confidence?: ConfidenceResult;
    authorityData?: AuthorityData;
    authorityStatus?: AuthorityStatus;
    isPro?: boolean;
    referenceId?: string;
    onRecheck?: (referenceId: string) => Promise<void> | void;
    healthState?: HealthState;
    healthReasons?: string[];
    reportEngineSnapshot?: ConvertedReference["reportEngineSnapshot"];
}

function authorityStatusLabel(status: AuthorityStatus): string {
    switch (status) {
        case "cache_hit": return "Validated (cache)";
        case "fetched": return "Validated";
        case "no_match": return "No match";
        case "error": return "Validation unavailable";
        case "blocked": return "Upgrade to validate";
        case "skipped": return "Validation skipped";
        default: return "";
    }
}

function confidenceBreakdownMessage({
    confidence,
    authorityStatus,
    healthState,
    healthReasons,
    reportEngineSnapshot,
}: Pick<ScholarPreviewProps, "confidence" | "authorityStatus" | "healthState" | "healthReasons" | "reportEngineSnapshot">): string {
    const primaryReason = healthReasons?.find(Boolean)?.replace(/\.$/, "");
    if (primaryReason) {
        if (healthState === "action_needed") {
            return `${primaryReason}. Adding more source detail usually helps, especially author, title, year, and venue.`;
        }
        if (healthState === "review") {
            return `${primaryReason}. The citation is still usable, but this part is worth a quick manual check.`;
        }
    }

    if (reportEngineSnapshot?.processingPath?.partialResult) {
        return "This result used a fallback path for part of the pipeline, so it is safer to review the fields before treating it as final.";
    }

    if (authorityStatus === "no_match") {
        return "The citation was built from local parsing, but external sources did not confirm an exact match.";
    }

    if (authorityStatus === "error") {
        return "The citation structure looks usable locally, but external validation could not complete on this run.";
    }

    if ((confidence?.score ?? 0) < 60) {
        return "The input did not contain enough reliable detail to extract a strong citation. Supplying more of the original reference will help.";
    }

    if ((confidence?.score ?? 0) < 85) {
        return "Most core fields were found, but one or more citation details still look incomplete or inconsistent.";
    }

    return "Core citation fields were extracted cleanly and no blocking health checks remain.";
}

function ScholarPreviewInner({ confidence, authorityData, authorityStatus, isPro = false, referenceId, onRecheck, healthState, healthReasons, reportEngineSnapshot }: ScholarPreviewProps) {
    const [isRechecking, setIsRechecking] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
            }
        };
    }, []);

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

    let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
    let icon = null;
    let bandLabel = "";
    let badgeClassName = "cursor-help flex items-center text-[10px] sm:text-xs h-6 px-2 font-normal";

    const canRecheck = Boolean(
        onRecheck
        && referenceId
        && reportEngineSnapshot?.engineVersion !== "v2"
        && (
            confidence.score < CONFIDENCE_THRESHOLDS.recheckCeiling
            || authorityStatus === "no_match"
            || authorityStatus === "error"
        )
    );

    if (healthState === "action_needed" || confidence.isSuspicious || confidence.score < CONFIDENCE_THRESHOLDS.actionNeeded) {
        badgeVariant = "destructive";
        icon = <AlertTriangle className="w-3 h-3 mr-1" />;
        bandLabel = healthState === "action_needed" ? "Needs action" : "";
    } else if (healthState === "review" || confidence.score <= CONFIDENCE_THRESHOLDS.review) {
        badgeVariant = "outline";
        icon = <AlertTriangle className="w-3 h-3 mr-1" />;
        bandLabel = healthState === "review" ? "Needs review" : "";
        badgeClassName += " border-amber-500/40 text-amber-100 hover:bg-amber-500/10";
    } else if (healthState === "clean") {
        badgeVariant = "default";
        icon = <CheckCircle2 className="w-3 h-3 mr-1" />;
        bandLabel = "Ready";
    } else if (confidence.score > CONFIDENCE_THRESHOLDS.review) {
        badgeVariant = "secondary";
    } else {
        badgeVariant = "outline";
        badgeClassName += " border-amber-500/40 text-amber-100 hover:bg-amber-500/10";
    }

    const statusLabel = authorityStatus ? authorityStatusLabel(authorityStatus) : "";

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
                Quality Score
            </h4>
            <div className="text-sm text-muted-foreground flex justify-between">
                <span>Score:</span>
                <span>{confidence.score}%</span>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
                {confidenceBreakdownMessage({ confidence, authorityStatus, healthState, healthReasons, reportEngineSnapshot })}
            </p>

            {authorityData && (
                <>
                    <div className="mt-4 pt-4 border-t">
                        <h5 className="text-xs font-semibold mb-2 flex items-center text-primary">
                            <Link className="h-3 w-3 mr-1" />
                            External validation record
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
                    Validation status: {statusLabel}
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

            {canRecheck && (
                <div className="mt-4 pt-4 border-t">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={isRechecking}
                        onClick={async () => {
                            if (!onRecheck || !referenceId) return;
                            setIsRechecking(true);
                            try {
                                await onRecheck(referenceId);
                            } finally {
                                setIsRechecking(false);
                            }
                        }}
                    >
                        <RefreshCw className={`w-3 h-3 mr-1 ${isRechecking ? "animate-spin" : ""}`} />
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
                        className={badgeClassName}
                        aria-label={bandLabel ? `${bandLabel}: ${confidence.score}%` : `Quality score: ${confidence.score}%`}
                        tabIndex={0}
                        role="button"
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        onTouchCancel={handleTouchEnd}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMobileOpen(true); } }}
                    >
                        {icon}
                        <span className="hidden sm:inline whitespace-nowrap">{bandLabel ? `${bandLabel} (${confidence.score}%)` : `${confidence.score}%`}</span>
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
                        <DialogTitle>Quality Score</DialogTitle>
                    </DialogHeader>
                    <div id="scholar-preview-desc">
                        {previewContent}
                    </div>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
}

export function getReferenceReviewProps(reference: Pick<ConvertedReference, "confidence" | "authorityData" | "authorityStatus" | "healthState" | "healthReasons" | "reportEngineSnapshot" | "review" | "adminReview">) {
    return {
        confidence: reference.review?.confidence ?? reference.confidence,
        authorityData: reference.authorityData,
        authorityStatus: reference.review?.authorityStatus ?? reference.authorityStatus,
        healthState: reference.review?.healthState ?? reference.healthState,
        healthReasons: reference.review?.healthReasons ?? reference.healthReasons,
        reportEngineSnapshot: reference.adminReview?.engineSnapshot ?? reference.reportEngineSnapshot,
    };
}

export const ScholarPreview = memo(ScholarPreviewInner);

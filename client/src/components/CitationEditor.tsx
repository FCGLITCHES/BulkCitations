import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateCitation } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";
import type { 
  CanonicalCitation, 
  ParsedReference, 
  CanonicalReferenceType, 
  CanonicalAuthor,
  FieldValue
} from "@shared/schema";
import { cn } from "@/lib/utils";

interface CitationEditorProps {
  isOpen: boolean;
  onClose: () => void;
  citation: CanonicalCitation;
  jobId: string;
  index: number;
  onUpdate?: (updated: CanonicalCitation) => void;
}

/** Helper to extract value from FieldValue or direct property */
function val<T>(field: FieldValue<T> | T | undefined): T | undefined {
  if (field === undefined) return undefined;
  if (field !== null && typeof field === 'object' && 'value' in field) {
    return (field as FieldValue<T>).value;
  }
  return field as T;
}

/** Helper to format authors for the form */
function formatAuthors(authors: FieldValue<CanonicalAuthor[]> | CanonicalAuthor[] | string[] | undefined): string[] {
  const extracted = val(authors);
  if (!extracted) return [];
  if (Array.isArray(extracted)) {
    return extracted.map(a => {
      if (typeof a === 'string') return a;
      // Format CanonicalAuthor to "Surname, G."
      const parts = [];
      const author = a as CanonicalAuthor;
      if (author.last) parts.push(author.last);
      if (author.first) parts.push(author.first);
      return parts.join(", ");
    });
  }
  return [];
}

export function CitationEditor({
  isOpen,
  onClose,
  citation,
  jobId,
  index,
  onUpdate,
}: CitationEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Local state for the editable fields (ParsedReference shape)
  const [formData, setFormData] = useState<Partial<ParsedReference>>({});
  const [localCitation, setLocalCitation] = useState<CanonicalCitation>(citation);

  // Map CanonicalCitation (FieldValue structure) to ParsedReference (flat strings)
  useEffect(() => {
    if (citation) {
      setLocalCitation(citation);
      
      const initialForm: Partial<ParsedReference> = {
        authors: formatAuthors(citation.authors),
        title: val(citation.title) || "",
        year: val(citation.year)?.toString() || "",
        journal: val(citation.journal) || "",
        volume: val(citation.volume) || "",
        issue: val(citation.issue) || "",
        pages: val(citation.pages) || "",
        doi: val(citation.doi) || "",
        publisher: val(citation.publisher) || "",
        placeOfPublication: val(citation.placeOfPublication) || "",
        url: val(citation.url) || "",
        referenceType: citation.referenceType || "unknown",
        bookTitle: val(citation.bookTitle) || "",
        conferenceTitle: val(citation.conferenceTitle) || "",
        institution: val(citation.institution) || "",
        edition: val(citation.edition) || "",
        editor: val(citation.editor) || "",
        repository: val(citation.repository) || "",
      };
      
      setFormData(initialForm);
    }
  }, [citation]);

  const mutation = useMutation({
    mutationFn: (data: Partial<ParsedReference>) => 
      updateCitation<{ citation: CanonicalCitation }>(jobId, index, data),
    onSuccess: (data: { citation: CanonicalCitation }) => {
      setLocalCitation(data.citation);
      onUpdate?.(data.citation);
      toast({
        title: "Citation Updated",
        description: `Status: ${data.citation.quality?.bucket.replace('_', ' ').toUpperCase()}`,
      });
      // Invalidate the main references query to refresh the list
      queryClient.invalidateQueries({ queryKey: ["/api/admin/references"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleFieldChange = (field: keyof ParsedReference, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    mutation.mutate(formData);
  };

  const bucket = localCitation.quality?.bucket || 'unknown';
  const bucketColor = 
    bucket === 'ready' ? 'bg-emerald-500' :
    bucket === 'worth_reviewing' ? 'bg-amber-500' :
    'bg-rose-500';

  const referenceTypes: { value: CanonicalReferenceType; label: string }[] = [
    { value: 'journal', label: 'Journal Article' },
    { value: 'book', label: 'Book' },
    { value: 'chapter', label: 'Book Chapter' },
    { value: 'conference', label: 'Conference Paper' },
    { value: 'report', label: 'Technical Report' },
    { value: 'thesis', label: 'Thesis/Dissertation' },
    { value: 'preprint', label: 'Preprint' },
    { value: 'website', label: 'Website' },
    { value: 'unknown', label: 'Unknown/Other' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl bg-white dark:bg-[#0f1419]">
        <DialogHeader className="p-6 bg-slate-900 text-white dark:bg-slate-950 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-headline font-black italic tracking-tight">
                Citation Repair Interface
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs font-medium">
                Admin Correction Queue • Job #{jobId.slice(0, 8).toUpperCase()} • Index {index}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Engine Health</span>
                <Badge className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter text-white", bucketColor)}>
                  {bucket.replace('_', ' ')}
                </Badge>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Left: Editor Form */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            <section className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-blue-500 text-sm">edit_note</span>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Identity Fields</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-400">Reference Type</Label>
                  <Select 
                    value={formData.referenceType || 'unknown'} 
                    onValueChange={(val) => handleFieldChange('referenceType', val)}
                  >
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                      <SelectValue placeholder="Select Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {referenceTypes.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-400">Year</Label>
                  <Input 
                    value={formData.year || ''} 
                    onChange={(e) => handleFieldChange('year', e.target.value)}
                    placeholder="e.g. 2021"
                    className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-600 dark:text-slate-400">Title</Label>
                <Input 
                  value={formData.title || ''} 
                  onChange={(e) => handleFieldChange('title', e.target.value)}
                  placeholder="The complete title of the work..."
                  className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-600 dark:text-slate-400">Authors (Semicolon separated)</Label>
                <Input 
                  value={Array.isArray(formData.authors) ? formData.authors.join("; ") : (formData.authors || '')} 
                  onChange={(e) => handleFieldChange('authors', e.target.value.split(";").map(s => s.trim()))}
                  placeholder="Smith, J.; DOE, John..."
                  className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-mono text-xs"
                />
              </div>
            </section>

            <section className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-blue-500 text-sm">library_books</span>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Container & Publication</h3>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-600 dark:text-slate-400">
                  {formData.referenceType === 'book' ? 'Publisher' : 'Journal / Conference / Book Title'}
                </Label>
                <Input 
                  value={formData.journal || formData.bookTitle || formData.conferenceTitle || ''} 
                  onChange={(e) => {
                    const val = e.target.value;
                    if (formData.referenceType === 'book') handleFieldChange('publisher', val);
                    else handleFieldChange('journal', val);
                  }}
                  className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-400">Volume</Label>
                  <Input 
                    value={formData.volume || ''} 
                    onChange={(e) => handleFieldChange('volume', e.target.value)}
                    className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 px-2"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-400">Issue</Label>
                  <Input 
                    value={formData.issue || ''} 
                    onChange={(e) => handleFieldChange('issue', e.target.value)}
                    className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 px-2"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-400">Pages</Label>
                  <Input 
                    value={formData.pages || ''} 
                    onChange={(e) => handleFieldChange('pages', e.target.value)}
                    className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 px-2"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-400">DOI</Label>
                  <Input 
                    value={formData.doi || ''} 
                    onChange={(e) => handleFieldChange('doi', e.target.value)}
                    className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 px-2 font-mono text-[10px]"
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Right: Status & Validation */}
          <div className="w-full md:w-80 bg-slate-50 dark:bg-slate-900/50 p-6 border-l border-slate-100 dark:border-slate-800 space-y-6">
            <div className="space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Quality Analysis</h3>
              
              <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Overall Score</span>
                  <span className="text-lg font-black italic text-slate-900 dark:text-white">
                    {Math.round((localCitation.quality?.overall || 0) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className={cn("h-full transition-all duration-500", bucketColor)} 
                    style={{ width: `${(localCitation.quality?.overall || 0) * 100}%` }}
                  />
                </div>
              </div>

              {localCitation.validationIssues && localCitation.validationIssues.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Active Blockers ({localCitation.validationIssues.length})</p>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                    {localCitation.validationIssues.map((issue, idx) => (
                      <div key={idx} className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/30 rounded-lg text-xs">
                        <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-bold mb-1">
                          <span className="material-symbols-outlined text-[14px]">warning</span>
                          {issue.field?.toUpperCase() || 'GENERAL'}
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                          {issue.message}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {bucket === 'ready' && (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/30 rounded-xl flex items-start gap-3">
                  <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-tighter">Ready for Release</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-500 font-medium">No blocker metadata detected. Citation meets quality standards.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-6 border-t border-slate-200 dark:border-slate-800">
               <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Original Raw Input</h3>
               <div className="p-3 bg-slate-100 dark:bg-slate-900 rounded-lg font-mono text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed break-words line-clamp-6 select-all">
                 {localCitation.raw}
               </div>
            </div>
          </div>
        </div>

        <DialogFooter className="p-6 bg-white dark:bg-[#0f1419] border-t border-slate-100 dark:border-slate-800 gap-3">
          <Button 
            variant="ghost" 
            onClick={onClose}
            className="font-bold text-slate-500"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={mutation.isPending}
            className="bg-[#002147] text-white dark:bg-blue-600 dark:text-white px-8 h-11 font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all flex items-center gap-2"
          >
            {mutation.isPending ? (
              <span className="material-symbols-outlined animate-spin">refresh</span>
            ) : (
              <span className="material-symbols-outlined text-[18px]">save</span>
            )}
            {mutation.isPending ? "Validating..." : "Apply & Recalculate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

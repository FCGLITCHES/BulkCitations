import { useState, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, Sparkles, RotateCw, Trash2, Beaker } from "lucide-react";
import { SAMPLE_MIXED_REFERENCES } from "@/lib/sampleReferences";
import { apiRequest } from "@/lib/queryClient";
import { ConversionRequest, ConversionResponse, INPUT_STYLES } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { stripLeadingNumbering } from "@shared/stripNumbering";
import { countEngineLikeInputReferences } from "@shared/liveReferenceDetection";

interface ReferenceInputProps {
  onConversionResult: (response: ConversionResponse) => void;
  onProcessingStart: (totalRefs: number) => void;
  onProcessingEnd: () => void;
  onError: (error: string) => void;
  isProcessing: boolean;
  isPro?: boolean;
  onOutputStyleChange?: (style: string) => void;
  engineVersion?: "v1" | "v2";
  groupDuplicates?: boolean;
  onGroupDuplicatesChange?: (value: boolean) => void;
  /** Prefill from extension capture batch (one ref per block, joined with \n\n). */
  initialCaptureText?: string;
}

export default function ReferenceInput({
  onConversionResult,
  onProcessingStart,
  onProcessingEnd,
  onError,
  isProcessing,
  isPro = false,
  onOutputStyleChange,
  engineVersion = "v2",
  groupDuplicates = true,
  onGroupDuplicatesChange,
  initialCaptureText = "",
}: ReferenceInputProps) {
  const [inputText, setInputText] = useState(initialCaptureText);
  const [inputStyle, setInputStyle] = useState("auto");
  const [outputStyle, setOutputStyle] = useState("apa");
  const [detectionStatus, setDetectionStatus] = useState("Ready to detect");
  const [referenceCount, setReferenceCount] = useState(0);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const { toast } = useToast();

  const convertMutation = useMutation({
    mutationFn: async (data: ConversionRequest) => {
      const response = await apiRequest("POST", "/api/convert", data);
      return response.json() as Promise<ConversionResponse>;
    },
    onSuccess: (data) => {
      onConversionResult(data);
      onProcessingEnd();
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : "Conversion failed");
      onProcessingEnd();
    }
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const allowedExtensions = ['.txt', '.pdf', '.docx'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      onError("Please upload a .txt, .pdf, or .docx file");
      return;
    }

    setIsFileUploading(true);

    try {
      if (file.type === 'text/plain' || fileExtension === '.txt') {
        // Handle text files directly
        const text = await file.text();
        setInputText(text);
        handleInputChange(text);

        toast({
          title: "File Uploaded!",
          description: `Loaded ${file.name} with references`,
        });
      } else {
        // Handle PDF, DOC, DOCX files via server
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/parse-file', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          const msg = (errBody as { details?: string; error?: string }).details
            || (errBody as { error?: string }).error
            || response.statusText;
          throw new Error(msg || 'Failed to parse file');
        }

        const result = await response.json() as { text?: string };

        if (result.text != null && String(result.text).trim()) {
          setInputText(result.text);
          handleInputChange(result.text);

          toast({
            title: "File Uploaded!",
            description: `Extracted text from ${file.name}`,
          });
        } else {
          onError("No text content found in the uploaded file");
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to read file content");
    } finally {
      setIsFileUploading(false);
      // Reset the input value so the same file can be uploaded again
      event.target.value = '';
    }
  };

  const handleInputChange = useCallback((value: string) => {
    setInputText(value);

    if (!value.trim()) {
      setReferenceCount(0);
      setDetectionStatus("No references detected");
      return;
    }

    const refCount = countEngineLikeInputReferences(value);

    setReferenceCount(refCount);

    if (refCount > 0 && inputStyle === "auto") {
      setDetectionStatus("Auto-detecting...");
    } else if (refCount === 0) {
      setDetectionStatus("No references detected");
    } else {
      setDetectionStatus("Ready to convert");
    }
  }, [inputStyle]);

  useEffect(() => {
    if (initialCaptureText) handleInputChange(initialCaptureText);
  }, [initialCaptureText, handleInputChange]);

  const handleConvert = (textOverride?: string | any) => {
    const actualText = typeof textOverride === 'string' ? textOverride : inputText;
    const source = actualText.trim();
    if (!source) {
      onError("Please enter some references to convert");
      return;
    }

    if (engineVersion === "v2") {
      onProcessingStart(Math.max(referenceCount, 1));
      convertMutation.mutate({
        content: source,
        inputStyle,
        outputStyle,
        isPro,
        enrichWithAuthority: false,
        engineVersion,
      });
      return;
    }

    // Parse references from input
    const text = source;
    const references = [];

    // Split by double newlines first (paragraph separation)
    const paragraphs = text.split(/\n\s*\n/);

    for (const paragraph of paragraphs) {
      if (paragraph.trim()) {
        const normalized = paragraph.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        // Split on IEEE-style [N] in the middle (e.g. "... 86-94 [19] Alam T") so merged refs become separate
        const parts = normalized.split(/\s+(\[\d+\])\s+/).filter(Boolean);
        if (parts.length >= 3) {
          references.push(stripLeadingNumbering(parts[0].trim()));
          for (let i = 1; i < parts.length; i += 2) {
            const refText = (parts[i] + ' ' + (parts[i + 1] ?? '')).trim();
            if (refText) references.push(stripLeadingNumbering(refText));
          }
        } else {
          const cleanRef = stripLeadingNumbering(normalized);
          if (cleanRef) references.push(cleanRef);
        }
      }
    }

    // If no double newlines found, try splitting by single newlines for numbered references
    if (references.length <= 1 && text.includes('\n')) {
      references.length = 0; // Clear the array
      const lines = text.split('\n');
      let currentRef = "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // Check if this line starts a new numbered reference (1., 2), 3 -, [4], etc.) or IEEE-style [19] at start
        const bracketNumMatch = trimmedLine.match(/^\s*\[\d+\]\s*(.+)/);
        const numberedMatch = bracketNumMatch ?? trimmedLine.match(/^\s*\[?\d+\]?\s*[.):\-–]\s*(.+)/);
        if (numberedMatch) {
          // Save previous reference if exists
          if (currentRef.trim()) {
            references.push(currentRef.trim());
          }
          // Start new reference (numbering already stripped by the match group)
          currentRef = numberedMatch[1];
        } else {
          // Continue current reference
          if (currentRef) {
            currentRef += " " + trimmedLine;
          } else {
            currentRef = trimmedLine;
          }
        }
      }

      // Add the last reference
      if (currentRef.trim()) {
        references.push(currentRef.trim());
      }
    }

    // If still only one reference, split by periods followed by capital letters (heuristic)
    if (references.length === 1 && references[0].length > 200) {
      const singleRef = references[0];
      references.length = 0;

      // Split on patterns that likely indicate new references
      const parts = singleRef.split(/\.\s+(?=[A-Z][a-z]+,\s+[A-Z])/);
      for (let i = 0; i < parts.length; i++) {
        let part = parts[i].trim();
        if (i < parts.length - 1) {
          part += '.'; // Add back the period
        }
        if (part.length > 20) { // Minimum length for a valid reference
          references.push(part);
        }
      }
    }

    if (references.length === 0) {
      onError("No valid references found in the input");
      return;
    }

    onProcessingStart(references.length);
    convertMutation.mutate({
      references,
      inputStyle,
      outputStyle,
      isPro,
      enrichWithAuthority: false,
      engineVersion,
    });
  };

  const handleClear = () => {
    setInputText("");
    setReferenceCount(0);
    setDetectionStatus("Ready to detect");
  };

  return (
    <section className="flex flex-col gap-6 w-full">
      <div className="flex justify-between items-end px-1">
        <h3 className="font-headline text-2xl font-bold text-primary-container dark:text-blue-50">Original Citations</h3>
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold text-primary-container bg-primary-container/10 px-2 py-1 rounded">
            {referenceCount} reference{referenceCount !== 1 ? 's' : ''} detected
          </span>
          {referenceCount > 0 && (
            <button 
              onClick={handleClear}
              className="text-xs font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-all"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between items-end px-1 -mt-2">
        <div className="flex flex-col gap-2 w-full sm:w-1/2">
          <label className="text-xs font-bold text-primary-container dark:text-slate-400 uppercase tracking-widest">Input Citation Style</label>
          <select 
            value={inputStyle}
            onChange={(e) => setInputStyle(e.target.value)}
            className="w-full bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant dark:border-slate-700/50 rounded p-3 text-sm focus:ring-2 focus:ring-primary-container dark:text-slate-200 outline-none transition-all cursor-pointer"
          >
            {INPUT_STYLES.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button 
          onClick={() => {
            setInputText(SAMPLE_MIXED_REFERENCES);
            handleInputChange(SAMPLE_MIXED_REFERENCES);
          }}
          className="text-xs font-bold uppercase tracking-widest text-primary-container border border-primary-container/20 hover:bg-primary-container bg-primary-container/5 hover:text-white px-6 py-3 rounded transition-all sm:w-auto w-full text-center"
        >
          Load Sample
        </button>
      </div>

      {/* Upload Zone Card */}
      <div 
        className={`bg-surface-container-lowest dark:bg-slate-800 rounded p-6 sm:p-8 border-2 border-dashed border-outline-variant dark:border-slate-700/50 hover:border-primary-container dark:hover:border-blue-400 transition-colors group flex flex-col min-h-[300px] sm:min-h-[400px] relative overflow-hidden ${!inputText.trim() ? "cursor-pointer" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) {
            handleFileUpload({ target: { files: [file], value: '' } } as any);
          }
        }}
        onClick={() => {
          if (!inputText.trim()) document.getElementById('file-upload-new')?.click();
        }}
      >
        <input
          id="file-upload-new"
          type="file"
          accept=".txt,.pdf,.docx"
          onChange={handleFileUpload}
          className="hidden"
        />

        {!inputText.trim() ? (
          <div className="flex flex-col items-center justify-center flex-grow pointer-events-none">
            <div className="w-16 h-16 bg-surface-container dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 group-hover:bg-primary-container group-hover:text-white dark:group-hover:bg-blue-600 transition-all duration-300">
              {isFileUploading ? (
                <RotateCw className="animate-spin text-3xl dark:text-slate-400" />
              ) : (
                <span className="material-symbols-outlined text-3xl dark:text-slate-400">upload_file</span>
              )}
            </div>
            <h4 className="text-xl font-bold text-primary-container dark:text-blue-50 mb-2 text-center">Drag & drop files here</h4>
            <p className="text-on-surface-variant dark:text-slate-400 text-center mb-8 text-sm sm:text-base">
              Accepting PDF, DOCX, or plain TXT bibliographies
            </p>
            <div className="w-full h-px bg-surface-container dark:bg-slate-800 mb-8"></div>
          </div>
        ) : null}
        
        <textarea 
          className={`w-full bg-transparent border-none focus:ring-0 text-on-surface dark:text-slate-200 placeholder:text-outline/50 dark:placeholder:text-slate-500 font-mono text-xs sm:text-sm leading-relaxed z-10 outline-none pr-4 sm:pr-6 custom-scrollbar ${inputText.trim() ? 'min-h-[400px] sm:min-h-[500px] flex-grow resize-y' : 'h-48 mt-auto resize-none'}`}
          placeholder={!inputText.trim() ? "Or paste your raw citations here...\n\ne.g. Smith, J. (2023). Future of Archiving. Oxford Journal..." : ""}
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Citation Style Selection */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-primary-container dark:text-slate-400 uppercase tracking-widest px-1">Target Citation Style</label>
        <select 
          value={outputStyle}
          onChange={(e) => { setOutputStyle(e.target.value); onOutputStyleChange?.(e.target.value); }}
          className="w-full bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant dark:border-slate-700/50 rounded p-3 text-sm focus:ring-2 focus:ring-primary-container dark:text-slate-200 outline-none transition-all cursor-pointer"
        >
          <option value="apa">APA (7th Edition)</option>
          <option value="mla">MLA (9th Edition)</option>
          <option value="chicago">Chicago Manual of Style (17th Ed.)</option>
          <option value="harvard">Harvard Referencing</option>
          <option value="vancouver">Vancouver System</option>
          <option value="ieee">IEEE</option>
        </select>
      </div>

      <button 
        onClick={() => handleConvert()}
        disabled={isProcessing || !inputText.trim()}
        className="w-full bg-primary-container py-4 rounded text-white font-bold tracking-wide flex items-center justify-center gap-3 shadow-lg shadow-primary-container/20 hover:bg-[#002f5f] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isProcessing ? (
          <RotateCw className="w-5 h-5 animate-spin" />
        ) : (
          <span className="material-symbols-outlined text-xl">auto_fix_high</span>
        )}
        {isProcessing ? "CONVERTING..." : "CONVERT REFERENCES"}
      </button>

      {/* Legacy toggle mapped to new UI style */}
      <div className="flex items-center justify-between sm:justify-end gap-4 mt-2 px-1">
        <label className="flex items-center gap-2 cursor-pointer text-xs text-on-surface-variant dark:text-slate-400 uppercase font-bold tracking-widest group">
          <input 
            type="checkbox" 
            checked={groupDuplicates} 
            onChange={(e) => onGroupDuplicatesChange?.(e.target.checked)}
            className="rounded border-outline-variant dark:border-slate-700 dark:bg-slate-800 text-primary-container focus:ring-primary-container dark:checked:bg-blue-600 h-3.5 w-3.5"
          />
          <span className="group-hover:text-primary-container dark:group-hover:text-blue-200 transition-colors">Group Duplicates</span>
        </label>
      </div>
    </section>
  );
}

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
import { stripLeadingNumbering } from "../../../shared/stripNumbering";

interface ReferenceInputProps {
  onConversionResult: (response: ConversionResponse) => void;
  onProcessingStart: (totalRefs: number) => void;
  onProcessingEnd: () => void;
  onError: (error: string) => void;
  isProcessing: boolean;
  isPro?: boolean;
  onOutputStyleChange?: (style: string) => void;
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

    const allowedTypes = ['text/plain'];
    const allowedExtensions = ['.txt'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      onError("Please upload a text file (.txt)");
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
        });

        if (!response.ok) {
          throw new Error('Failed to parse file');
        }

        const result = await response.json();

        if (result.text && result.text.trim()) {
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
      onError("Failed to read file content");
    } finally {
      setIsFileUploading(false);
      // Reset the input value so the same file can be uploaded again
      event.target.value = '';
    }
  };

  const handleInputChange = useCallback((value: string) => {
    setInputText(value);

    // Count references using the same logic as handleConvert
    const text = value.trim();
    let refCount = 0;

    if (!text) {
      setReferenceCount(0);
      setDetectionStatus("No references detected");
      return;
    }

    // Split by double newlines first (paragraph separation)
    const paragraphs = text.split(/\n\s*\n/);
    refCount = paragraphs.filter(p => p.trim()).length;

    // If no double newlines found, try counting numbered references
    if (refCount <= 1 && text.includes('\n')) {
      const lines = text.split('\n');
      refCount = 0;

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.match(/^\d+\.\s*(.+)/)) {
          refCount++;
        }
      }

      // If no numbered references found, estimate by author patterns
      if (refCount === 0) {
        const authorPatterns = text.match(/[A-Z][a-z]+,\s+[A-Z]\./g) || [];
        refCount = Math.max(1, authorPatterns.length);
      }
    }

    setReferenceCount(refCount);

    // Update detection status
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

  const handleConvert = (textOverride?: string) => {
    const source = (textOverride ?? inputText).trim();
    if (!source) {
      onError("Please enter some references to convert");
      return;
    }

    // Parse references from input
    const text = source;
    const references = [];

    // Split by double newlines first (paragraph separation)
    const paragraphs = text.split(/\n\s*\n/);

    for (const paragraph of paragraphs) {
      if (paragraph.trim()) {
        // Clean up the paragraph and strip any leading numbering
        const cleanRef = stripLeadingNumbering(
          paragraph.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
        );
        if (cleanRef) {
          references.push(cleanRef);
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

        // Check if this line starts a new numbered reference (1., 2), 3 -, [4], etc.)
        const numberedMatch = trimmedLine.match(/^\s*\[?\d+\]?\s*[.):\-–]\s*(.+)/);
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
      enrichWithAuthority: isPro,
    });
  };

  const handleClear = () => {
    setInputText("");
    setReferenceCount(0);
    setDetectionStatus("Ready to detect");
  };

  return (
    <div className="space-y-6">
      {/* Input Style Detection */}
      <div>
        <Label className="text-sm font-medium text-foreground mb-2">Input Citation Style</Label>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <Select value={inputStyle} onValueChange={setInputStyle}>
            <SelectTrigger className="w-full sm:flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INPUT_STYLES.map((style) => (
                <SelectItem key={style.value} value={style.value}>
                  {style.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center text-sm text-muted-foreground shrink-0">
            <Sparkles className="mr-2 h-4 w-4 text-accent flex-shrink-0" />
            <span className="truncate">{detectionStatus}</span>
          </div>
        </div>
      </div>

      {/* Try Sample Button */}
      <Button
        variant="outline"
        size="sm"
        className="mb-3 text-primary border-primary/50 hover:bg-primary/5"
        onClick={() => {
          setInputText(SAMPLE_MIXED_REFERENCES);
          handleInputChange(SAMPLE_MIXED_REFERENCES);
          toast({
            title: "Sample loaded",
            description: "Click Convert to see output",
          });
        }}
      >
        <Beaker className="mr-2 h-4 w-4" />
        Try sample mixed references
      </Button>

      {/* Reference Input Area */}
      <div>
        <Label className="text-sm font-medium text-foreground mb-2 block">
          Paste Your References
          <span className="text-muted-foreground font-normal ml-1 text-xs sm:text-sm">(separate by blank lines or use numbers: 1., 2., 3.)</span>
        </Label>
        <Textarea
          className="min-h-[180px] sm:min-h-[200px] resize-none font-mono text-sm w-full max-w-full"
          placeholder={`Examples - Separate with blank lines:

Smith, J. (2023). The future of academic writing. Journal of Education, 45(2), 123-145.

Johnson, M., & Brown, L. (2022). Research methodologies in digital humanities. Academic Press.

Or use numbered format:
1. Thompson, K. (2023). Citation management tools. Education Today.
2. Davis, P. (2022). Modern research methods. Academic Publishers.`}
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
        />
      </div>

      {/* Upload Option */}
      <Card className="border-2 border-dashed border-muted-foreground/25">
        <CardContent className="flex flex-col items-center justify-center py-6">
          <Upload className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-2">Or upload a file with your references</p>
          <Button
            variant="ghost"
            className="text-primary hover:bg-primary/5"
            onClick={() => document.getElementById('file-upload')?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Choose File
          </Button>
          <input
            id="file-upload"
            type="file"
            accept=".txt"
            onChange={handleFileUpload}
            className="hidden"
          />
          <p className="text-xs text-muted-foreground mt-2">Supports .txt files with references</p>
        </CardContent>
      </Card>

      {/* Reference Count Display */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{referenceCount} references detected</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="text-primary hover:underline"
        >
          <Trash2 className="mr-1 h-3 w-3" />
          Clear All
        </Button>
      </div>

      {/* Convert Button */}
      <div className="pt-4 border-t">
        <Label className="text-sm font-medium text-foreground mb-2">Convert to Style</Label>
        <Select value={outputStyle} onValueChange={(v) => { setOutputStyle(v); onOutputStyleChange?.(v); }}>
          <SelectTrigger className="mb-4">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apa">APA (7th Edition)</SelectItem>
            <SelectItem value="mla">MLA (9th Edition)</SelectItem>
            <SelectItem value="harvard">Harvard</SelectItem>
            <SelectItem value="chicago">Chicago (17th Edition)</SelectItem>
            <SelectItem value="ieee">IEEE</SelectItem>
            <SelectItem value="vancouver">Vancouver</SelectItem>
          </SelectContent>
        </Select>

        <Button
          onClick={handleConvert}
          disabled={isProcessing || !inputText.trim()}
          className="w-full"
        >
          {isProcessing ? (
            <>
              <RotateCw className="mr-2 h-4 w-4 animate-spin" />
              Converting...
            </>
          ) : (
            <>
              <RotateCw className="mr-2 h-4 w-4" />
              Convert References
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

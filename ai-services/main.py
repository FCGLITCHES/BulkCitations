from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
import pdfplumber
import docx
import io
import re

app = FastAPI(title="Citing AI Engine")

class ExtractionResult(BaseModel):
    sourceType: str
    rawString: str
    filePosition: int | None = None
    ingestionConfidence: float = 1.0

class DetectFormatRequest(BaseModel):
    citation: str

class DetectFormatResponse(BaseModel):
    style: str
    confidence: float
    alternates: dict[str, float]

class ExtractEntitiesRequest(BaseModel):
    citation: str

class EntityExtraction(BaseModel):
    entity: str
    word: str
    confidence: float

class ExtractEntitiesResponse(BaseModel):
    entities: list[EntityExtraction]

class ParseAuthorsRequest(BaseModel):
    authors_string: str

class AuthorEntity(BaseModel):
    entity: str
    word: str
    confidence: float

class ParseAuthorsResponse(BaseModel):
    author_entities: list[AuthorEntity]

class ClassifyTypeRequest(BaseModel):
    citation: str

class ClassifyTypeResponse(BaseModel):
    reference_type: str
    confidence: float

class LinePairRequest(BaseModel):
    line1: str
    line2: str

class LinePairResponse(BaseModel):
    action: str # SAME_CITATION | NEW_CITATION
    confidence: float

@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Citing AI Engine is running"}

@app.post("/extract-text", response_model=list[ExtractionResult])
async def extract_text_from_file(file: UploadFile = File(...)):
    """
    Phase 1: Ingestion — Raw document parsing preserving structures.
    Uses pdfplumber to maintain column layout signals.
    """
    contents = await file.read()
    results = []

    if file.filename.lower().endswith(".pdf"):
        try:
            with pdfplumber.open(io.BytesIO(contents)) as pdf:
                # Structure-aware text extraction handling multi-column layouts
                for idx, page in enumerate(pdf.pages):
                    text = page.extract_text(layout=True)
                    if text:
                        cleaned = text.strip()
                        if cleaned:
                            results.append(ExtractionResult(
                                sourceType="pdf",
                                rawString=cleaned,
                                filePosition=idx + 1,
                                ingestionConfidence=0.95
                            ))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"PDF Extractions failed: {str(e)}")
            
    elif file.filename.lower().endswith(".docx"):
        try:
            doc = docx.Document(io.BytesIO(contents))
            # Paragraph-level extraction
            for idx, para in enumerate(doc.paragraphs):
                text = para.text.strip()
                if text:
                    results.append(ExtractionResult(
                        sourceType="docx",
                        rawString=text,
                        filePosition=idx + 1,
                        ingestionConfidence=0.98
                    ))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"DOCX Extractions failed: {str(e)}")
    
    else:
        # Fallback TXT recovery route
        text = contents.decode("utf-8", errors="replace").strip()
        results.append(ExtractionResult(
            sourceType="txt",
            rawString=text,
            filePosition=1,
            ingestionConfidence=1.0
        ))
        
    return results

@app.post("/line-pair-classifier", response_model=LinePairResponse)
def classify_line_pair(request: LinePairRequest):
    """
    Phase 2: Citation Splitting (Line-Pair Classifier subset)
    Tiny binary classifier predicting if line2 is a continuation of line1 or a NEW_CITATION.
    Stubbed heuristic prior to fine-tune replacement.
    """
    l2 = request.line2.strip()
    
    # Simple hardcoded fallback heuristic for wrapped items
    if re.match(r"^[A-Z]\.", l2) or re.match(r"^\[\d+\]", l2) or re.match(r"^\d+\.", l2):
        return LinePairResponse(action="NEW_CITATION", confidence=0.85)
        
    # Default to assuming continuation if no bold markers of breaking
    return LinePairResponse(action="SAME_CITATION", confidence=0.60)


@app.post("/detect-format", response_model=DetectFormatResponse)
def detect_format(request: DetectFormatRequest):
    """
    Phase 3: Format Detection
    Upgrade from NLI zero-shot to a fine-tuned multi-label classifier stub.
    """
    # NOTE: This is a proxy stub for the DistilBERT-base inference logic
    # Need to load the model in startup sequence:
    # pipeline("text-classification", model="custom-distilbert-citation-format")
    
    # Temporary mock based on regex heuristics until model is downloaded
    citation = request.citation.strip()
    if re.match(r"^\[\d+\]", citation):
        return DetectFormatResponse(style="ieee", confidence=0.98, alternates={"vancouver": 0.01})
    if re.search(r"\(\d{4}[a-z]?\)\.", citation):
        return DetectFormatResponse(style="apa", confidence=0.91, alternates={"harvard": 0.06})
        
    return DetectFormatResponse(style="apa", confidence=0.55, alternates={"mla": 0.20, "chicago": 0.15})

@app.post("/extract-entities", response_model=ExtractEntitiesResponse)
def extract_entities(request: ExtractEntitiesRequest):
    """
    Phase 4: Field Extraction
    Uses SciBERT sequence labeler to parse out citation fields exactly.
    """
    # NOTE: Proxy stub. In production, load the pipeline:
    # ner = pipeline("ner", model="SIRIS-Lab/citation-parser-ENTITY", aggregation_strategy="simple")
    # results = ner(request.citation.strip())
    
    citation = request.citation.strip()
    
    # Simple heuristic fallback mock simulating the exact JSON response of huggingface aggregation_strategy="simple"
    entities = []
    
    # Just a fake mock representing a SciBERT parse for the V2 Typescript architecture to digest
    words = citation.split()
    if len(words) > 0:
        entities.append(EntityExtraction(entity="B-author", word=words[0], confidence=0.95))
        
    for i in range(1, min(len(words), 3)):
        entities.append(EntityExtraction(entity="I-author", word=words[i], confidence=0.99))
        
    if len(words) > 3:
        entities.append(EntityExtraction(entity="B-title", word=words[3], confidence=0.85))
        for i in range(4, len(words) - 2):
            entities.append(EntityExtraction(entity="I-title", word=words[i], confidence=0.95))
            
    if len(words) >= 2:
        entities.append(EntityExtraction(entity="B-year", word=words[-2], confidence=0.99))
        entities.append(EntityExtraction(entity="B-journal", word=words[-1], confidence=0.99))
        
    return ExtractEntitiesResponse(entities=entities)

@app.post("/parse-authors", response_model=ParseAuthorsResponse)
def parse_authors(request: ParseAuthorsRequest):
    """
    Phase 5: Author Disambiguation NER
    Uses affilgood-NER-multilingual to extract structured author subfields (e.g., GivenName, FamilyName) from raw author strings.
    """
    # NOTE: Proxy stub. In production: pipeline("ner", model="SIRIS-Lab/affilgood-NER-multilingual")
    raw_str = request.authors_string.strip()
    words = raw_str.split()
    entities = []
    
    if len(words) >= 2:
        entities.append(AuthorEntity(entity="B-FamilyName", word=words[0].replace(',', ''), confidence=0.98))
        entities.append(AuthorEntity(entity="B-GivenName", word=words[1], confidence=0.95))
        for i in range(2, len(words)):
            entities.append(AuthorEntity(entity="I-GivenName", word=words[i], confidence=0.9))
    elif len(words) == 1:
        entities.append(AuthorEntity(entity="B-FamilyName", word=words[0], confidence=0.95))
        
    return ParseAuthorsResponse(author_entities=entities)

@app.post("/classify-type", response_model=ClassifyTypeResponse)
def classify_type(request: ClassifyTypeRequest):
    """
    Phase 6: Reference Type multi-class
    Classifies the citation as article-journal, book, paper-conference, etc.
    """
    # NOTE: Proxy stub. In production: pipeline("text-classification")
    citation = request.citation.strip().lower()
    
    if "journal" in citation or "vol." in citation or "pp." in citation:
        return ClassifyTypeResponse(reference_type="article-journal", confidence=0.88)
    if "thesis" in citation or "dissertation" in citation:
        return ClassifyTypeResponse(reference_type="thesis", confidence=0.95)
    if "press" in citation or "isbn" in citation:
        return ClassifyTypeResponse(reference_type="book", confidence=0.82)
        
    return ClassifyTypeResponse(reference_type="article-journal", confidence=0.55)

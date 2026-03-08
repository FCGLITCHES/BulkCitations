import { Request, Response } from 'express';
import { CitationService } from '../services/citationService';
import { CitationStyle, ConversionRequest } from '../types/citation';

export const convertCitation = async (req: Request, res: Response) => {
  try {
    const citationService = CitationService.getInstance();
    const request: ConversionRequest = req.body;
    
    const result = await citationService.convertCitation(request);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      convertedReferences: [],
      errors: [error instanceof Error ? error.message : 'Unknown error occurred']
    });
  }
};

export const getSupportedStyles = (_req: Request, res: Response) => {
  res.json(Object.values(CitationStyle));
}; 
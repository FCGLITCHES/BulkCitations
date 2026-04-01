import { Router } from 'express';
import { v2ConversionRequestSchema } from '@shared/schema';
import { processV3Conversion } from '../engine/v3/pipeline.js';

const router = Router();

router.post('/convert', async (req, res) => {
  try {
    const request = v2ConversionRequestSchema.parse(req.body);
    const { response } = await processV3Conversion(request, { executionMode: 'sync' });
    res.json(response);
  } catch (error) {
    res.status(400).json({
      message: 'Invalid v3 conversion request',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;

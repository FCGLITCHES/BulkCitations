import { type Reference, type InsertReference } from "@shared/schema";

export interface IStorage {
  getReference(id: number): Promise<Reference | undefined>;
  createReference(reference: InsertReference): Promise<Reference>;
  createReferences(references: InsertReference[]): Promise<Reference[]>;
}

export class MemStorage implements IStorage {
  private references: Map<number, Reference>;
  private currentId: number;

  constructor() {
    this.references = new Map();
    this.currentId = 1;
  }

  async getReference(id: number): Promise<Reference | undefined> {
    return this.references.get(id);
  }

  async createReference(insertReference: InsertReference): Promise<Reference> {
    const id = this.currentId++;
    const reference: Reference = {
      id,
      originalText: insertReference.originalText,
      inputStyle: insertReference.inputStyle,
      outputStyle: insertReference.outputStyle,
      parsedData: insertReference.parsedData ?? null,
      convertedText: insertReference.convertedText ?? null,
      referenceType: insertReference.referenceType ?? null,
      confidenceScore: insertReference.confidenceScore ?? null,
      workKey: insertReference.workKey ?? null,
      patternHits: insertReference.patternHits ?? null,
      authorityStatus: insertReference.authorityStatus ?? null,
      createdAt: new Date(),
    };
    this.references.set(id, reference);
    return reference;
  }

  async createReferences(insertReferences: InsertReference[]): Promise<Reference[]> {
    const results: Reference[] = [];
    for (const insertRef of insertReferences) {
      const ref = await this.createReference(insertRef);
      results.push(ref);
    }
    return results;
  }
}

export const storage = new MemStorage();

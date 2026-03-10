import { ParsedReference, CitationStyle, ReferenceType } from "@shared/schema";

export class CitationConverter {
  // Helper: append ". " without creating ".." when result already ends with "."
  private appendPeriodSpace(result: string): string {
    if (result.endsWith('.')) return result + ' ';
    return result + '. ';
  }

  // Convert parsed reference to target style
  convertToStyle(parsed: ParsedReference, targetStyle: CitationStyle, referenceType: ReferenceType): string {
    switch (targetStyle) {
      case 'apa':
        return this.convertToAPA(parsed, referenceType);
      case 'mla':
        return this.convertToMLA(parsed, referenceType);
      case 'harvard':
        return this.convertToHarvard(parsed, referenceType);
      case 'chicago':
        return this.convertToChicago(parsed, referenceType);
      case 'ieee':
        return this.convertToIEEE(parsed, referenceType);
      case 'vancouver':
        return this.convertToVancouver(parsed, referenceType);
      default:
        return this.convertToGeneric(parsed);
    }
  }

  private convertToAPA(parsed: ParsedReference, type: ReferenceType): string {
    let result = '';

    // Author (surname followed by initials)
    if (parsed.authors && parsed.authors.length > 0) {
      result += this.formatAuthorsAPA(parsed.authors);
    } else {
      result += 'Unknown Author';
    }

    // Year of publication (in round brackets)
    if (parsed.year) {
      result += ` (${parsed.year})`;
    } else {
      result += ' (n.d.)';
    }

    result = this.appendPeriodSpace(result);

    // Title of article
    if (parsed.title) {
      result += `${parsed.title}`;
    } else {
      result += 'Unknown Title';
    }

    result = this.appendPeriodSpace(result);

    // Journal/Publisher specific formatting
    if (type === 'journal' && parsed.journal) {
      // Title of journal (in italics)
      result += `*${parsed.journal}*`;

      // Volume number (in italics) and part number/issue (in round brackets)
      if (parsed.volume) {
        result += `, *${parsed.volume}*`;
        if (parsed.issue) {
          result += `(${parsed.issue})`;
        }
      }

      // Page numbers
      if (parsed.pages) {
        result += `, ${parsed.pages}`;
      }
    } else if (type === 'book' && parsed.publisher) {
      if (parsed.placeOfPublication) {
        result += `${parsed.placeOfPublication}: `;
      }
      result += parsed.publisher;
    } else if (type === 'website' && parsed.url) {
      result += parsed.url;
    }

    result += '.';

    // DOI
    if (parsed.doi) {
      result += ` https://doi.org/${parsed.doi}`;
    }

    return result;
  }

  private convertToMLA(parsed: ParsedReference, type: ReferenceType): string {
    let result = '';

    // Author(s) - Last, First format
    if (parsed.authors && parsed.authors.length > 0) {
      result += this.formatAuthorsMLA(parsed.authors);
    } else {
      result += 'Unknown Author';
    }

    result = this.appendPeriodSpace(result);

    // Title of Article (in quotation marks for journal articles)
    if (parsed.title) {
      if (type === 'journal') {
        // Remove any trailing period from title first, then add proper punctuation
        const cleanTitle = parsed.title.replace(/\.$/, '');
        const endPunct = /[?!]$/.test(cleanTitle) ? '' : '.';
        result += `"${cleanTitle}${endPunct}"`;
      } else {
        result += `*${parsed.title}*`;
      }
    } else {
      result += '"Unknown Title."';
    }

    result += ' ';

    // Journal/Publisher specific formatting
    if (type === 'journal' && parsed.journal) {
      // Title of Journal (in italics)
      result += `*${parsed.journal}*`;

      // Volume and issue in MLA 9th edition format
      if (parsed.volume) {
        result += ` ${parsed.volume}`;
        if (parsed.issue) {
          result += `.${parsed.issue}`;
        }
      }

      // Year in parentheses
      if (parsed.year) {
        result += ` (${parsed.year})`;
      }

      // Page numbers with colon
      if (parsed.pages) {
        result += `: ${parsed.pages}`;
      }

      // Add final period
      result += '.';
    } else if (type === 'book') {
      if (parsed.placeOfPublication) {
        result += `${parsed.placeOfPublication}: `;
      }
      if (parsed.publisher) {
        result += `${parsed.publisher}, `;
      }
      if (parsed.year) {
        result += parsed.year;
      }
      result += '.';
    } else {
      result += '.';
    }

    // DOI if available
    if (parsed.doi) {
      result += ` https://doi.org/${parsed.doi}`;
    }

    return result;
  }

  private convertToHarvard(parsed: ParsedReference, type: ReferenceType): string {
    let result = '';

    // Author (surname followed by initials)
    if (parsed.authors && parsed.authors.length > 0) {
      result += this.formatAuthorsHarvard(parsed.authors);
    } else {
      result += 'Unknown Author';
    }

    result = this.appendPeriodSpace(result);

    // Year of publication (in round brackets)
    if (parsed.year) {
      result += `(${parsed.year})`;
    } else {
      result += '(n.d.)';
    }

    result = this.appendPeriodSpace(result);

    // Title of article (in single quotation marks)
    if (parsed.title) {
      if (type === 'journal') {
        result += `'${parsed.title}'`;
      } else {
        result += `*${parsed.title}*`;
      }
    } else {
      result += "'Unknown Title'";
    }

    result += ', ';

    // Journal/Publisher specific formatting
    if (type === 'journal' && parsed.journal) {
      // Title of journal (in italics)
      result += `*${parsed.journal}*`;

      // Issue information: volume (unbracketed) and part number/issue (in round brackets)
      if (parsed.volume) {
        result += `, ${parsed.volume}`;
        if (parsed.issue) {
          result += `(${parsed.issue})`;
        }
      }

      // Page reference with pp.
      if (parsed.pages) {
        result += `, pp. ${parsed.pages}`;
      }
    } else if (type === 'book' && parsed.publisher) {
      if (parsed.placeOfPublication) {
        result += `${parsed.placeOfPublication}: `;
      }
      result += parsed.publisher;
    }

    result += '.';

    // DOI (if available)
    if (parsed.doi) {
      result += ` doi: ${parsed.doi}`;
    }

    return result;
  }

  private convertToChicago(parsed: ParsedReference, type: ReferenceType): string {
    let result = '';

    // Author(s) - First Last format for Chicago Notes & Bibliography
    if (parsed.authors && parsed.authors.length > 0) {
      result += this.formatAuthorsChicago(parsed.authors);
    } else {
      result += 'Unknown Author';
    }

    result = this.appendPeriodSpace(result);

    // Title of Article (in quotation marks for journal articles)
    if (parsed.title) {
      if (type === 'journal') {
        const cleanTitle = parsed.title.replace(/\.$/, '');
        // Don't add period if title ends with ? or !
        const endPunct = /[?!]$/.test(cleanTitle) ? '' : '.';
        result += `"${cleanTitle}${endPunct}"`;
      } else {
        result += `*${parsed.title}*`;
      }
    } else {
      result += '"Unknown Title."';
    }

    result += ' ';

    // Journal/Publisher specific formatting
    if (type === 'journal' && parsed.journal) {
      // Title of Journal (in italics)
      result += `*${parsed.journal}*`;

      // Volume number
      if (parsed.volume) {
        result += ` ${parsed.volume}`;
      }

      // Issue number
      if (parsed.issue) {
        result += `, no. ${parsed.issue}`;
      }

      // Year (in parentheses)
      if (parsed.year) {
        result += ` (${parsed.year})`;
      }

      // Page range (with colon)
      if (parsed.pages) {
        result += `: ${parsed.pages}`;
      }
    } else if (type === 'book') {
      if (parsed.placeOfPublication) {
        result += `${parsed.placeOfPublication}: `;
      }
      if (parsed.publisher) {
        result += `${parsed.publisher}, `;
      }
      if (parsed.year) {
        result += parsed.year;
      }
    }

    result += '.';

    // DOI if available
    if (parsed.doi) {
      result += ` https://doi.org/${parsed.doi}`;
    }

    return result;
  }

  private convertToIEEE(parsed: ParsedReference, type: ReferenceType): string {
    let result = '';

    // Author(s)
    if (parsed.authors && parsed.authors.length > 0) {
      result += this.formatAuthorsIEEE(parsed.authors);
    } else {
      result += 'Unknown Author';
    }

    result += ', ';

    // Title
    if (parsed.title) {
      result += `"${parsed.title},"`;
    } else {
      result += '"[Unknown Title],"';
    }

    result += ' ';

    // Journal/Publisher specific formatting
    if (type === 'journal' && parsed.journal) {
      result += `*${parsed.journal}*`;
      if (parsed.volume) {
        result += `, vol. ${parsed.volume}`;
      }
      if (parsed.issue) {
        result += `, no. ${parsed.issue}`;
      }
      if (parsed.pages) {
        result += `, pp. ${parsed.pages}`;
      }
      if (parsed.year) {
        result += `, ${parsed.year}`;
      }
    } else if (type === 'book') {
      if (parsed.placeOfPublication) {
        result += `${parsed.placeOfPublication}: `;
      }
      if (parsed.publisher) {
        result += `${parsed.publisher}, `;
      }
      if (parsed.year) {
        result += parsed.year;
      }
    }

    result += '.';
    return result;
  }

  private convertToVancouver(parsed: ParsedReference, type: ReferenceType): string {
    let result = '';

    // Author(s) surname Initial(s)
    if (parsed.authors && parsed.authors.length > 0) {
      result += this.formatAuthorsVancouver(parsed.authors);
    } else {
      result += 'Unknown Author';
    }

    result = this.appendPeriodSpace(result);

    // Title of article
    if (parsed.title) {
      result += `${parsed.title}`;
    } else {
      result += 'Unknown Title';
    }

    result = this.appendPeriodSpace(result);

    // Journal/Publisher specific formatting
    if (type === 'journal' && parsed.journal) {
      // Abbreviated title of journal [online] for electronic sources
      result += `${parsed.journal} [online]`;

      // Year of publication
      if (parsed.year) {
        result += `. ${parsed.year}`;
      }

      // Volume number(issue number):page numbers
      if (parsed.volume) {
        result += `;${parsed.volume}`;
        if (parsed.issue) {
          result += `(${parsed.issue})`;
        }
        if (parsed.pages) {
          result += `:${parsed.pages}`;
        }
      }

      result += '.';

      // DOI preferred over URL
      if (parsed.doi) {
        result += ` Available from: https://doi.org/${parsed.doi}`;
      } else if (parsed.url) {
        result += ` Available from: ${parsed.url}`;
      }
    } else if (type === 'book') {
      if (parsed.placeOfPublication) {
        result += `${parsed.placeOfPublication}: `;
      }
      if (parsed.publisher) {
        result += `${parsed.publisher}; `;
      }
      if (parsed.year) {
        result += parsed.year;
      }
      result += '.';
    }

    return result;
  }

  private convertToGeneric(parsed: ParsedReference): string {
    let result = '';

    if (parsed.authors && parsed.authors.length > 0) {
      result += parsed.authors.join(', ');
    }

    if (parsed.year) {
      result += ` (${parsed.year})`;
    }

    if (parsed.title) {
      result += `. ${parsed.title}`;
    }

    if (parsed.journal) {
      result += `. ${parsed.journal}`;
    }

    if (parsed.volume || parsed.issue || parsed.pages) {
      result += ', ';
      if (parsed.volume) result += `${parsed.volume}`;
      if (parsed.issue) result += `(${parsed.issue})`;
      if (parsed.pages) result += `, ${parsed.pages}`;
    }

    return result + '.';
  }

  // Helper methods for author formatting

  /**
   * Normalize an author name to "Surname, I." format (used by APA, Harvard, MLA first author).
   * Handles inputs like:
   *   "A. Kumar" -> "Kumar, A."
   *   "Kumar, A." -> "Kumar, A." (already correct)
   *   "Ahmed K. Ibrahim" -> "Ibrahim, A. K."
   */
  private normalizeToSurnameFirst(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;

    // Already in "Surname, Initial" format — ensure initials have periods
    if (/^[A-Z][a-z\u00c0-\u00ff']+(?:\s+[a-z]+)*,\s/.test(trimmed)) {
      // Ensure each standalone capital letter has a period after it
      const commaIdx = trimmed.indexOf(',');
      const surname = trimmed.substring(0, commaIdx);
      const initials = trimmed.substring(commaIdx + 1).trim();
      const fixedInitials = initials.replace(/\b([A-Z])(?![.\w])/g, '$1.');
      return `${surname}, ${fixedInitials}`;
    }

    // IEEE format: "I. Surname" or "I. I. Surname"
    const ieeeMatch = trimmed.match(/^((?:[A-Z]\.?\s*)+)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)$/);
    if (ieeeMatch) {
      const initials = ieeeMatch[1].trim().replace(/\s+/g, ' ');
      const surname = ieeeMatch[2].trim();
      return `${surname}, ${initials}`;
    }

    // "First Last" format (e.g., "John Smith")
    const firstLastMatch = trimmed.match(/^([A-Z][a-z]+(?:\s+[A-Z]\.?)*)\s+([A-Z][a-z]+)$/);
    if (firstLastMatch) {
      const first = firstLastMatch[1].trim();
      const last = firstLastMatch[2].trim();
      // Convert first name to initial
      const initial = first.charAt(0) + '.';
      return `${last}, ${initial}`;
    }

    return trimmed;
  }

  /**
   * Normalize an author name to "I. Surname" format (used by IEEE).
   * Handles inputs like:
   *   "Kumar, A." -> "A. Kumar"
   *   "A. Kumar" -> "A. Kumar" (already correct)  
   *   "Kumar, A. B." -> "A. B. Kumar"
   */
  private normalizeToInitialFirst(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;

    // "Surname, Initial(s)" format
    const surnameFirstMatch = trimmed.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*((?:[A-Z]\.?\s*)+)$/);
    if (surnameFirstMatch) {
      const surname = surnameFirstMatch[1].trim();
      const initials = surnameFirstMatch[2].trim().replace(/\s+/g, ' ');
      return `${initials} ${surname}`;
    }

    // Already in "I. Surname" format
    if (/^[A-Z]\.?\s+[A-Z]/.test(trimmed)) {
      return trimmed;
    }

    return trimmed;
  }

  private formatAuthorsAPA(authors: string[]): string {
    const normalized = authors.map(a => this.normalizeToSurnameFirst(a));
    if (normalized.length === 1) {
      return normalized[0];
    } else if (normalized.length === 2) {
      return `${normalized[0]}, & ${normalized[1]}`;
    } else {
      const allButLast = normalized.slice(0, -1);
      const lastAuthor = normalized[normalized.length - 1];
      return `${allButLast.join(', ')}, & ${lastAuthor}`;
    }
  }

  private formatAuthorsMLA(authors: string[]): string {
    const normalized = authors.map(a => this.normalizeToSurnameFirst(a).replace(/\.$/, ''));
    if (normalized.length === 1) {
      return normalized[0];
    } else if (normalized.length === 2) {
      return `${normalized[0]}, and ${normalized[1]}`;
    } else {
      const allButLast = normalized.slice(0, -1);
      const lastAuthor = normalized[normalized.length - 1];
      return `${allButLast.join(', ')}, and ${lastAuthor}`;
    }
  }

  private formatAuthorsHarvard(authors: string[]): string {
    const normalized = authors.map(a => this.normalizeToSurnameFirst(a));
    if (normalized.length === 1) {
      return normalized[0];
    } else if (normalized.length === 2) {
      return `${normalized[0]} & ${normalized[1]}`;
    } else {
      const allButLast = normalized.slice(0, -1);
      const lastAuthor = normalized[normalized.length - 1];
      return `${allButLast.join(', ')} & ${lastAuthor}`;
    }
  }

  private formatAuthorsChicago(authors: string[]): string {
    // Chicago first author: Surname, First; subsequent: First Surname
    const normalized = authors.map(a => this.normalizeToSurnameFirst(a));
    if (normalized.length === 1) {
      return normalized[0];
    } else if (normalized.length === 2) {
      return `${normalized[0]}, and ${normalized[1]}`;
    } else {
      const allButLast = normalized.slice(0, -1);
      const lastAuthor = normalized[normalized.length - 1];
      return `${allButLast.join(', ')}, and ${lastAuthor}`;
    }
  }

  private formatAuthorsIEEE(authors: string[]): string {
    const normalized = authors.map(a => this.normalizeToInitialFirst(a));
    if (normalized.length === 1) {
      return normalized[0];
    } else if (normalized.length <= 6) {
      const allButLast = normalized.slice(0, -1);
      const lastAuthor = normalized[normalized.length - 1];
      return `${allButLast.join(', ')} and ${lastAuthor}`;
    } else {
      return `${normalized[0]} et al.`;
    }
  }

  private formatAuthorsVancouver(authors: string[]): string {
    const normalized = authors.map(a => this.normalizeToSurnameFirst(a));
    if (normalized.length === 1) {
      return normalized[0];
    } else if (normalized.length <= 6) {
      return normalized.join(', ');
    } else {
      return `${normalized.slice(0, 6).join(', ')}, et al.`;
    }
  }
}

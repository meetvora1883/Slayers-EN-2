module.exports = {
  sanitizeName: (name) => {
    if (!name) return '';
    return name
      .replace(/[^\p{L}\s-]/gu, '')  // Keep letters/spaces/hyphens
      .replace(/\s+/g, ' ')          // Collapse spaces
      .replace(/-+/g, '-')           // Normalize hyphens
      .trim()
      .slice(0, 32);                 // Limit length
  },

  extractNameAndID: (content) => {
    if (!content) return { name: null, id: null, rank: null, normalized: null };

    // Normalization phase (handles all spacing/separator variations)
    const normalized = content
      .replace(/\s*[:=-]\s*/g, ':')  // Convert all separators to colons
      .replace(/\s+/g, ' ')          // Collapse multiple spaces
      .trim();

    console.log(`[NORMALIZED] "${content}" → "${normalized}"`);

    // Master pattern (works after normalization)
    const masterPattern = /^(?:name:)?(.+?)(?::|$)(\d+)(?::(\d+))?$/i;
    const match = normalized.match(masterPattern);

    if (match) {
      return {
        name: match[1]?.trim() || null,
        id: match[2]?.trim() || null,
        rank: match[3]?.trim() || null,
        normalized: normalized // Pass through for validation
      };
    }

    return { name: null, id: null, rank: null, normalized: null };
  },

  formatOutput: (name, id) => {
    return `${this.sanitizeName(name)} | ${id}`;
  }
};

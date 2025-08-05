module.exports = {
  sanitizeName: (name) => {
    return name
      .replace(/[^\p{L}\s-]/gu, '')  // Keep letters, spaces, hyphens
      .replace(/\s+/g, ' ')          // Collapse multiple spaces
      .replace(/-+/g, '-')           // Remove repeated hyphens
      .trim()
      .slice(0, 32);                // Limit to 32 chars
  },

  extractNameAndID: (content) => {
    // Trim and normalize input
    const text = content.trim();

    // Case 1: Handle "Name | ID" format (e.g., "Patel Slayers | 123456")
    const pipeFormat = text.match(/^(.+?)\s*\|\s*(\d+)$/);
    if (pipeFormat) {
      return {
        name: pipeFormat[1].trim(),
        id: pipeFormat[2].trim(),
        rank: null
      };
    }

    // Case 2: Handle "Name - ID" or "Name: ID" (fallback)
    const separatorFormat = text.match(/^(.+?)\s*[:-]\s*(\d+)$/);
    if (separatorFormat) {
      return {
        name: separatorFormat[1].trim(),
        id: separatorFormat[2].trim(),
        rank: null
      };
    }

    // Case 3: Multi-line format (Name\nID)
    const lines = text.split('\n').map(line => line.trim());
    if (lines.length >= 2 && /^\d+$/.test(lines[1])) {
      return {
        name: lines[0],
        id: lines[1],
        rank: lines[2] || null
      };
    }

    // No match found
    return { name: null, id: null, rank: null };
  }
};

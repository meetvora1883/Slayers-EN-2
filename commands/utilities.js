module.exports = {
  sanitizeName: (name) => {
    return name
      .replace(/[^\p{L}\s-]/gu, '')  // Keep only letters, spaces, hyphens
      .replace(/\s+/g, ' ')          // Collapse multiple spaces
      .replace(/-+/g, '-')            // Collapse multiple hyphens
      .trim()
      .slice(0, 32);                 // Limit to 32 chars
  },

  extractNameAndID: (content) => {
    const patterns = [
      // Key-Value formats (supports all spacing/hyphen/colon variations)
      /Name\s*[:-]\s*(.+?)\s*(?:\n|$)\s*ID\s*[:-]\s*(\d+)\s*(?:\n|$)\s*Rank\s*[:-]\s*(\d+)/i,
      /Name\s*[:-]\s*(.+?)\s*(?:\n|$)\s*ID\s*[:-]\s*(\d+)/i,
      /(.+?)\s*[:-]\s*(\d+)\s*(?:\n|$)\s*Rank\s*[:-]\s*(\d+)/i,
      /(.+?)\s*[:-]\s*(\d+)/i,

      // Multi-line format (Name\nID\nRank)
      /^(.+?)\n(\d+)(?:\n(\d+))?$/,
    ];

    for (const pattern of patterns) {
      const match = content.trim().match(pattern);
      if (match) {
        return {
          name: match[1]?.trim() || null,
          id: match[2]?.trim() || null,
          rank: match[3]?.trim() || null,
        };
      }
    }

    return { name: null, id: null, rank: null }; // No match found
  }
};

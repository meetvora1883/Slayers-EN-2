// commands/utilities.js
module.exports = {
  /**
   * Sanitizes a name by removing unwanted characters
   * @param {string} name - The input name to sanitize
   * @returns {string} The sanitized name
   */
  sanitizeName: (name) => {
    // Preserve spaces between names but remove other special chars
    return name
      .replace(/[^\p{L}\s-]/gu, '') // Only allow letters, spaces, and hyphens
      .replace(/\s+/g, ' ')         // Collapse multiple spaces
      .trim()
      .slice(0, 32);
  },

  /**
   * Extracts name and ID from message content
   * @param {string} content - The message content
   * @returns {Object} {name, id} or {null, null} if invalid
   */
  extractNameAndID: (content) => {
    // Try line-by-line format first
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    if (lines.length >= 2 && /^\d+$/.test(lines[1])) {
      return {
        name: lines[0],
        id: lines[1]
      };
    }

    // Try separator format
    const separators = ['-', ':-', ':', ' -', ' :-', ' :', '- ', ':- ', ': ', ' - ', ' :- ', ' : '];
    ];
    for (const sep of separators) {
      const parts = content.split(sep).map(part => part.trim());
      if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
        return {
          name: parts[0],
          id: parts[1]
        };
      }
    }

    return { name: null, id: null };
  }
};

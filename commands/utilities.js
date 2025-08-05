module.exports = {
  sanitizeName: (name) => {
    return name
      .replace(/[^\p{L}\s-]/gu, '') // Only allow letters, spaces, and hyphens
      .replace(/\s+/g, ' ')         // Collapse multiple spaces
      .trim()
      .slice(0, 32);
  },

  extractNameAndID: (content) => {
    // Try line-by-line format
    const lines = content.split('\n').map(line => line.trim());
    if (lines.length >= 2 && /^\d+$/.test(lines[1])) {
      return { name: lines[0], id: lines[1] };
    }

    // Try separator format
    const separators = ['-', ':-', ':', ' -', ' :-', ' :', '- ', ':- ', ': ', ' - ', ' :- ', ' : '];
    for (const sep of separators) {
      const parts = content.split(sep).map(part => part.trim());
      if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
        return { name: parts[0], id: parts[1] };
      }
    }

    return { name: null, id: null };
  }
};

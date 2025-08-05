module.exports = {
  sanitizeName: (name) => {
    // Remove emojis
    let cleaned = name.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
    
    // Remove invisible characters
    cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');
    
    // Remove mentions
    cleaned = cleaned.replace(/@(here|everyone|[!&]?[0-9]{17,20})/g, '');
    
    return cleaned.trim().slice(0, 32);
  },

  extractNameAndID: (content) => {
    const separators = ['-', ':-', ':', ' -', ' :-', ' :', '- ', ':- ', ': ', ' - ', ' :- ', ' : '];
    
    for (const sep of separators) {
      const parts = content.split(sep);
      if (parts.length >= 2) {
        return {
          name: parts[0].trim(),
          id: parts[1].trim().split(/\s+/)[0] // Get first word after separator
        };
      }
    }

    // Fallback to line-by-line parsing
    const lines = content.split('\n').map(line => line.trim());
    if (lines.length >= 2) {
      return {
        name: lines[0],
        id: lines[1]
      };
    }

    return { name: null, id: null };
  }
};

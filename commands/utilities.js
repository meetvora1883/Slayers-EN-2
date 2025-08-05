/**
 * Discord Bot Utilities Module
 * Handles name sanitization, ID extraction, and nickname formatting
 */

module.exports = {
  /**
   * Sanitizes and normalizes a display name
   * @param {string} name - Raw name input
   * @returns {string} Sanitized name
   */
  sanitizeName: (name) => {
    if (!name || typeof name !== 'string') return '';
    
    return name
      .replace(/[^\p{L}\s-]/gu, '')  // Remove non-letter characters
      .replace(/\s+/g, ' ')          // Collapse multiple spaces
      .replace(/-+/g, '-')           // Normalize hyphens
      .trim()
      .slice(0, 32);                 // Enforce max length
  },

  /**
   * Extracts name, ID, and rank from user input
   * @param {string} content - Raw message content
   * @returns {object} {name, id, rank, normalized}
   */
  extractNameAndID: (content) => {
    // Validate input
    if (!content || typeof content !== 'string') {
      console.error('[ERROR] extractNameAndID: Invalid input', content);
      return { name: null, id: null, rank: null, normalized: null };
    }

    // Normalization phase
    const normalized = content
      .replace(/[\r\n\t]/g, ' ')      // Standardize whitespace
      .replace(/\s*[:=-]\s*/g, ':')   // Normalize all separators to colon
      .replace(/\s+/g, ' ')           // Collapse spaces
      .trim();

    console.log(`[NORMALIZED] "${content}" → "${normalized}"`);

    // Pattern matching with priority
    const patterns = [
      // 1. Explicit labeled format (name:... id:... rank:...)
      /^(?:name:)?(.+?)(?::|$)(\d+)(?::(\d+))?$/i,
      
      // 2. Implicit colon format (...:...:...)
      /^(.+?):(\d+)(?::(\d+))?$/,
      
      // 3. Hyphen-separated format (...-...-...)
      /^(.+?)[-](\d+)(?:[-](\d+))?$/
    ];

    // Try patterns in priority order
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        return {
          name: match[1]?.trim() || null,
          id: match[2]?.trim() || null,
          rank: match[3]?.trim() || null,
          normalized: normalized
        };
      }
    }

    console.warn('[WARN] No pattern matched:', content);
    return { name: null, id: null, rank: null, normalized: null };
  },

  /**
   * Formats the final nickname
   * @param {string} name - Sanitized name
   * @param {string} id - User ID
   * @returns {string} Formatted "Name | ID"
   */
  formatOutput: (name, id) => {
    const cleanName = this.sanitizeName(name);
    if (!cleanName || !id) {
      throw new Error(`Invalid format inputs: name=${name}, id=${id}`);
    }
    return `${cleanName} | ${id}`;
  },

  /**
   * Validates the nickname format
   * @param {string} nickname - Potential nickname
   * @returns {boolean} True if valid format
   */
  isValidNicknameFormat: (nickname) => {
    return /^[\p{L}\s-]{1,32} \| \d+$/u.test(nickname);
  }
};

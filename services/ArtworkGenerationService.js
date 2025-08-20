const logger = require('./logger');
const cloudflareService = require('./cloudflare');

/**
 * HSL-based Artwork Generation Service
 * Generates consistent artwork from music prompts using HSL color system
 */
class ArtworkGenerationService {
  
  constructor() {
    this.artworkPath = 'VeeqAI/Artwork/'; // Same path as FeaturedMusicService
  }
  
  /**
   * Main function: Generate artwork from music prompt and upload to CDN
   */
  static async generateArtworkFromPrompt(prompt, genre = null, mood = null, musicId = null) {
    try {
      logger.info(`🎨 [ARTWORK] Generating for prompt: ${prompt.substring(0, 50)}...`);
      
      // 1. Generate base color (preset or generated)
      let baseColor;
      let source;
      
      const presetColor = this.getPresetColor(genre, mood, prompt);
      if (presetColor) {
        baseColor = presetColor;
        source = 'preset';
      } else {
        // 2. Generate hash from prompt
        const hash = this.generateHash(prompt);
        
        // 3. Generate HSL values
        const hsl = this.generateHSLFromHash(hash);
        
        // 4. Convert to HEX
        baseColor = this.hslToHex(hsl.h, hsl.s, hsl.l);
        source = 'generated';
      }
      
      // 5. Create artwork data
      const artworkData = this.createArtworkData(baseColor, source);
      
      // 6. Generate SVG content
      const svgContent = this.generateSVG(artworkData, prompt);
      logger.info(`🎨 [ARTWORK] SVG generated, length: ${svgContent.length} chars`);
      
      // 7. Upload to CDN if musicId provided
      let cdnUrl = null;
      if (musicId) {
        logger.info(`📤 [ARTWORK] Attempting CDN upload for music: ${musicId}`);
        try {
          cdnUrl = await this.uploadToCDN(musicId, svgContent);
          artworkData.cdnUrl = cdnUrl;
          logger.info(`✅ [ARTWORK] CDN upload successful: ${cdnUrl}`);
        } catch (uploadError) {
          logger.error(`❌ [ARTWORK] CDN upload failed for music ${musicId}:`, uploadError);
          // Continue without CDN, use gradient fallback
        }
      } else {
        logger.info(`⚠️ [ARTWORK] No musicId provided, skipping CDN upload`);
      }
      
      logger.info(`✅ [ARTWORK] Generated: ${baseColor} for prompt${cdnUrl ? `, CDN: ${cdnUrl}` : ' (no CDN)'}`);
      return artworkData;
      
    } catch (error) {
      logger.error(`❌ [ARTWORK] Generation failed:`, error);
      return this.getFallbackArtwork();
    }
  }

  /**
   * Generate consistent hash from text
   */
  static generateHash(text) {
    let hash = 0;
    if (!text) return hash;
    
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash);
  }

  /**
   * Generate HSL values from hash
   */
  static generateHSLFromHash(hash) {
    // Hue: Full spectrum (0-360°)
    const h = hash % 360;
    
    // Saturation: Rich colors (65-90%)
    const s = 65 + (hash % 25);
    
    // Lightness: Dark colors for white text (25-40%)
    const l = 25 + (hash % 15);
    
    return { h, s, l };
  }

  /**
   * Convert HSL to HEX
   */
  static hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  /**
   * Create complete artwork data object
   */
  static createArtworkData(baseColor, source) {
    const rgb = this.hexToRgb(baseColor);
    
    // Create gradient variants
    const darkerColor = this.adjustBrightness(baseColor, -30);
    const lighterColor = this.adjustBrightness(baseColor, 20);
    
    // CSS gradient
    const gradient = `linear-gradient(135deg, ${darkerColor} 0%, ${baseColor} 50%, ${lighterColor} 100%)`;
    
    // Determine text color based on brightness
    const textColor = this.getContrastTextColor(baseColor);
    
    return {
      baseColor,
      gradient,
      textColor,
      darkerColor,
      lighterColor,
      source, // 'preset' or 'generated'
      timestamp: new Date().toISOString(),
      // For frontend CSS
      style: {
        background: gradient,
        color: textColor
      }
    };
  }

  /**
   * Get preset colors for specific genres/moods
   */
  static getPresetColor(genre, mood, prompt) {
    const presets = {
      // Genre-based presets
      'jazz': '#E65100',      // Orange
      'classical': '#2E7D32', // Green  
      'rock': '#37474F',      // Dark Grey
      'electronic': '#1565C0', // Blue
      'pop': '#C62828',       // Red
      'ambient': '#00695C',   // Teal
      'hip-hop': '#5D4037',   // Brown
      'blues': '#283593',     // Indigo
      
      // Mood-based presets  
      'calm': '#4CAF50',      // Green
      'energetic': '#FF5722', // Deep Orange
      'sad': '#3F51B5',       // Indigo
      'happy': '#FFC107',     // Amber
      'dark': '#424242',      // Dark Grey
      'romantic': '#E91E63'   // Pink
    };
    
    // Check genre first
    if (genre && presets[genre.toLowerCase()]) {
      return presets[genre.toLowerCase()];
    }
    
    // Check mood
    if (mood && presets[mood.toLowerCase()]) {
      return presets[mood.toLowerCase()];
    }
    
    // Check prompt for keywords
    const lowerPrompt = prompt.toLowerCase();
    for (const [key, color] of Object.entries(presets)) {
      if (lowerPrompt.includes(key)) {
        return color;
      }
    }
    
    return null;
  }

  /**
   * Adjust color brightness
   */
  static adjustBrightness(hex, amount) {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;
    
    const r = Math.max(0, Math.min(255, rgb.r + amount));
    const g = Math.max(0, Math.min(255, rgb.g + amount));
    const b = Math.max(0, Math.min(255, rgb.b + amount));
    
    return this.rgbToHex(r, g, b);
  }

  /**
   * Get contrasting text color
   */
  static getContrastTextColor(hex) {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return '#FFFFFF';
    
    // YIQ formula for brightness
    const yiq = ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000;
    
    return yiq >= 128 ? '#000000' : '#FFFFFF';
  }

  /**
   * Convert HEX to RGB
   */
  static hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  /**
   * Convert RGB to HEX
   */
  static rgbToHex(r, g, b) {
    return `#${[r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('')}`;
  }

  /**
   * Generate SVG artwork content with Cloud Jukebox style patterns
   */
  static generateSVG(artworkData, prompt) {
    const { baseColor, gradient, textColor, darkerColor, lighterColor } = artworkData;
    
    // Generate pattern type based on prompt hash
    const hash = this.generateHash(prompt);
    const patternType = hash % 12; // 12 different pattern types
    
    let patternElements = '';
    
    switch (patternType) {
      case 0: // Dots pattern (like Cloud Jukebox)
        patternElements = this.generateDotsPattern(textColor);
        break;
      case 1: // Geometric triangles
        patternElements = this.generateTrianglesPattern(textColor);
        break;  
      case 2: // Circles and bokeh
        patternElements = this.generateCirclesPattern(textColor);
        break;
      case 3: // Diamond shapes
        patternElements = this.generateDiamondsPattern(textColor);
        break;
      case 4: // Wave lines
        patternElements = this.generateWavesPattern(textColor);
        break;
      case 5: // Mixed geometric
        patternElements = this.generateMixedPattern(textColor);
        break;
      case 6: // Hexagon pattern
        patternElements = this.generateHexagonPattern(textColor);
        break;
      case 7: // Lines/Stripes pattern
        patternElements = this.generateLinesPattern(textColor);
        break;
      case 8: // Stars pattern
        patternElements = this.generateStarsPattern(textColor);
        break;
      case 9: // Spiral pattern
        patternElements = this.generateSpiralPattern(textColor);
        break;
      case 10: // Grid/Mesh pattern
        patternElements = this.generateGridPattern(textColor);
        break;
      default: // Organic shapes pattern
        patternElements = this.generateOrganicPattern(textColor);
    }
    
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${darkerColor};stop-opacity:1" />
      <stop offset="50%" style="stop-color:${baseColor};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${lighterColor};stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Background -->
  <rect width="512" height="512" fill="url(#bgGradient)" />
  
  <!-- Pattern Elements -->
  ${patternElements}
  
</svg>`;
    
    return svgContent;
  }

  /**
   * Generate dots pattern like Cloud Jukebox
   */
  static generateDotsPattern(color) {
    let dots = '';
    const rows = 16;
    const cols = 16;
    const spacing = 32;
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * spacing + 16;
        const y = row * spacing + 16;
        const opacity = Math.random() * 0.6 + 0.2; // 0.2 to 0.8
        const radius = Math.random() * 8 + 4; // 4 to 12px
        
        dots += `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" opacity="${opacity}" />`;
      }
    }
    
    return dots;
  }

  /**
   * Generate triangular pattern
   */
  static generateTrianglesPattern(color) {
    let triangles = '';
    const gridSize = 64;
    
    for (let x = 0; x < 512; x += gridSize) {
      for (let y = 0; y < 512; y += gridSize) {
        const opacity = Math.random() * 0.4 + 0.1;
        const size = Math.random() * 30 + 20;
        
        triangles += `<polygon points="${x + size/2},${y} ${x},${y + size} ${x + size},${y + size}" 
                     fill="${color}" opacity="${opacity}" />`;
      }
    }
    
    return triangles;
  }

  /**
   * Generate circles pattern
   */
  static generateCirclesPattern(color) {
    let circles = '';
    
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const radius = Math.random() * 40 + 10;
      const opacity = Math.random() * 0.3 + 0.1;
      
      circles += `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" opacity="${opacity}" />`;
    }
    
    return circles;
  }

  /**
   * Generate diamond shapes
   */
  static generateDiamondsPattern(color) {
    let diamonds = '';
    const gridSize = 80;
    
    for (let x = 0; x < 512; x += gridSize) {
      for (let y = 0; y < 512; y += gridSize) {
        const opacity = Math.random() * 0.4 + 0.1;
        const size = Math.random() * 25 + 15;
        const centerX = x + gridSize/2;
        const centerY = y + gridSize/2;
        
        diamonds += `<polygon points="${centerX},${centerY - size} ${centerX + size},${centerY} 
                    ${centerX},${centerY + size} ${centerX - size},${centerY}" 
                    fill="${color}" opacity="${opacity}" />`;
      }
    }
    
    return diamonds;
  }

  /**
   * Generate wave lines
   */
  static generateWavesPattern(color) {
    let waves = '';
    
    for (let i = 0; i < 8; i++) {
      const y = i * 64 + 32;
      const opacity = Math.random() * 0.5 + 0.2;
      
      waves += `<path d="M0,${y} Q128,${y - 20} 256,${y} T512,${y}" 
               stroke="${color}" stroke-width="3" fill="none" opacity="${opacity}" />`;
    }
    
    return waves;
  }

  /**
   * Generate mixed geometric pattern
   */
  static generateMixedPattern(color) {
    let mixed = '';
    
    // Add some circles
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const radius = Math.random() * 20 + 5;
      const opacity = Math.random() * 0.3 + 0.1;
      
      mixed += `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" opacity="${opacity}" />`;
    }
    
    // Add some squares
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * 456;
      const y = Math.random() * 456;
      const size = Math.random() * 30 + 20;
      const opacity = Math.random() * 0.3 + 0.1;
      
      mixed += `<rect x="${x}" y="${y}" width="${size}" height="${size}" 
               fill="${color}" opacity="${opacity}" />`;
    }
    
    return mixed;
  }

  /**
   * Generate hexagon pattern
   */
  static generateHexagonPattern(color) {
    let hexagons = '';
    const gridSize = 60;
    
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const x = col * gridSize + (row % 2) * 30; // Offset every other row
        const y = row * gridSize * 0.75;
        const opacity = Math.random() * 0.4 + 0.1;
        const size = Math.random() * 20 + 15;
        
        // Hexagon points
        const points = [];
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          const px = x + size * Math.cos(angle);
          const py = y + size * Math.sin(angle);
          points.push(`${px},${py}`);
        }
        
        hexagons += `<polygon points="${points.join(' ')}" fill="${color}" opacity="${opacity}" />`;
      }
    }
    
    return hexagons;
  }

  /**
   * Generate lines/stripes pattern
   */
  static generateLinesPattern(color) {
    let lines = '';
    
    // Diagonal lines
    for (let i = 0; i < 20; i++) {
      const x1 = i * 30;
      const y1 = 0;
      const x2 = i * 30 + 200;
      const y2 = 512;
      const opacity = Math.random() * 0.3 + 0.1;
      const width = Math.random() * 4 + 2;
      
      lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
               stroke="${color}" stroke-width="${width}" opacity="${opacity}" />`;
    }
    
    // Horizontal lines  
    for (let i = 0; i < 12; i++) {
      const y = i * 45;
      const opacity = Math.random() * 0.2 + 0.1;
      const width = Math.random() * 3 + 1;
      
      lines += `<line x1="0" y1="${y}" x2="512" y2="${y}" 
               stroke="${color}" stroke-width="${width}" opacity="${opacity}" />`;
    }
    
    return lines;
  }

  /**
   * Generate stars pattern
   */
  static generateStarsPattern(color) {
    let stars = '';
    
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const size = Math.random() * 15 + 8;
      const opacity = Math.random() * 0.6 + 0.2;
      
      // 5-point star
      const points = [];
      for (let j = 0; j < 10; j++) {
        const angle = (j * Math.PI) / 5;
        const radius = j % 2 === 0 ? size : size * 0.4;
        const px = x + radius * Math.cos(angle - Math.PI / 2);
        const py = y + radius * Math.sin(angle - Math.PI / 2);
        points.push(`${px},${py}`);
      }
      
      stars += `<polygon points="${points.join(' ')}" fill="${color}" opacity="${opacity}" />`;
    }
    
    return stars;
  }

  /**
   * Generate spiral pattern
   */
  static generateSpiralPattern(color) {
    let spirals = '';
    
    for (let s = 0; s < 3; s++) {
      const centerX = 128 + s * 128;
      const centerY = 256;
      const opacity = Math.random() * 0.4 + 0.2;
      
      let path = `M${centerX},${centerY}`;
      let radius = 5;
      
      for (let angle = 0; angle < Math.PI * 8; angle += 0.2) {
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        path += ` L${x},${y}`;
        radius += 0.8;
      }
      
      spirals += `<path d="${path}" stroke="${color}" stroke-width="2" 
                 fill="none" opacity="${opacity}" />`;
    }
    
    return spirals;
  }

  /**
   * Generate grid/mesh pattern
   */
  static generateGridPattern(color) {
    let grid = '';
    const cellSize = 32;
    
    // Vertical lines
    for (let x = 0; x <= 512; x += cellSize) {
      const opacity = Math.random() * 0.3 + 0.1;
      grid += `<line x1="${x}" y1="0" x2="${x}" y2="512" 
              stroke="${color}" stroke-width="1" opacity="${opacity}" />`;
    }
    
    // Horizontal lines
    for (let y = 0; y <= 512; y += cellSize) {
      const opacity = Math.random() * 0.3 + 0.1;
      grid += `<line x1="0" y1="${y}" x2="512" y2="${y}" 
              stroke="${color}" stroke-width="1" opacity="${opacity}" />`;
    }
    
    // Add some filled cells
    for (let i = 0; i < 20; i++) {
      const gridX = Math.floor(Math.random() * 16) * cellSize;
      const gridY = Math.floor(Math.random() * 16) * cellSize;
      const opacity = Math.random() * 0.2 + 0.05;
      
      grid += `<rect x="${gridX}" y="${gridY}" width="${cellSize}" height="${cellSize}" 
              fill="${color}" opacity="${opacity}" />`;
    }
    
    return grid;
  }

  /**
   * Generate organic shapes pattern
   */
  static generateOrganicPattern(color) {
    let organic = '';
    
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const opacity = Math.random() * 0.3 + 0.1;
      const size = Math.random() * 40 + 20;
      
      // Create organic blob using bezier curves
      const x1 = x - size/2;
      const y1 = y;
      const x2 = x;
      const y2 = y - size/2;
      const x3 = x + size/2;
      const y3 = y;
      const x4 = x;
      const y4 = y + size/2;
      
      // Control points for organic shape
      const cx1 = x1 + Math.random() * size/3;
      const cy1 = y1 - Math.random() * size/3;
      const cx2 = x2 + Math.random() * size/3;
      const cy2 = y2 - Math.random() * size/3;
      const cx3 = x3 - Math.random() * size/3;
      const cy3 = y3 + Math.random() * size/3;
      const cx4 = x4 - Math.random() * size/3;
      const cy4 = y4 + Math.random() * size/3;
      
      organic += `<path d="M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2} 
                 C${cx2},${cy2} ${cx3},${cy3} ${x3},${y3}
                 C${cx3},${cy3} ${cx4},${cy4} ${x4},${y4}
                 C${cx4},${cy4} ${cx1},${cy1} ${x1},${y1} Z"
                 fill="${color}" opacity="${opacity}" />`;
    }
    
    return organic;
  }

  /**
   * Upload SVG to CDN using VeeqAI/Artwork/ path
   */
  static async uploadToCDN(musicId, svgContent) {
    try {
      const artworkPath = 'VeeqAI/Artwork/'; // Same path as FeaturedMusicService
      const fileName = `${musicId}_artwork_${Date.now()}.svg`;
      const cdnPath = `${artworkPath}${fileName}`;
      
      // Convert SVG string to buffer
      const svgBuffer = Buffer.from(svgContent, 'utf8');
      
      // Upload to Cloudflare R2
      const cdnUrl = await cloudflareService.uploadBuffer(
        svgBuffer,
        cdnPath,
        'image/svg+xml'
      );
      
      logger.info(`☁️ [ARTWORK] Uploaded to CDN: ${cdnUrl}`);
      return cdnUrl;
      
    } catch (error) {
      logger.error(`❌ [ARTWORK] CDN upload failed:`, error);
      throw error; // Let caller handle the error
    }
  }

  /**
   * Fallback artwork for errors
   */
  static getFallbackArtwork() {
    return this.createArtworkData('#6366F1', 'fallback'); // Indigo
  }
}

module.exports = ArtworkGenerationService;
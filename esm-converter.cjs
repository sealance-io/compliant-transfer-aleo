#!/usr/bin/env node

/**
 * ESM Import Compatibility Script
 * 
 * This script scans JavaScript and TypeScript files to update import statements
 * for ESM compatibility by ensuring proper file extensions are included.
 */

const fs = require('fs').promises;
const path = require('path');
const { existsSync } = require('fs');

// Configuration
const CONFIG = {
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose'),
  directory: process.argv[2] || '.',
  extensions: ['.js', '.mjs', '.ts', '.mts'],
  backupFiles: process.argv.includes('--backup'),
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    '.git',
    'package-lock.json',
    'yarn.lock'
  ]
};

// Import regular expressions
const IMPORT_REGEX = {
  // Matches ES6 imports, captures the import path
  esm: /import(?:["'\s]*([\w*{}\n\r\t, ]+)from\s*)?["'\s]*([^"';\s]+)["'\s]*/g,
  // Matches dynamic imports
  dynamic: /import\s*\(\s*["'](.*?)["']\s*\)/g,
  // Matches export ... from statements
  exportFrom: /export\s+(?:.*\s+)?from\s+["']([^"']+)["']/g,
  // Matches re-export statements
  reExport: /export\s*{[^}]*}\s*from\s*["']([^"']+)["']/g,
};

/**
 * Main function to process a directory recursively
 */
async function processDirectory(directoryPath) {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(directoryPath, entry.name);
      
      // Skip ignored patterns
      if (CONFIG.ignorePatterns.some(pattern => 
        fullPath.includes(pattern) || entry.name.includes(pattern))) {
        continue;
      }
      
      if (entry.isDirectory()) {
        await processDirectory(fullPath);
      } else if (entry.isFile() && CONFIG.extensions.includes(path.extname(entry.name))) {
        await processFile(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error processing directory ${directoryPath}:`, error);
  }
}

/**
 * Process a single file to update imports
 */
async function processFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const originalContent = content;
    
    // Skip files that are likely already using proper ESM imports
    // This is just a heuristic and might need refinement
    const isLikelyESM = filePath.endsWith('.mjs') || filePath.endsWith('.mts') || 
                        content.includes('export default') || 
                        content.includes('import {') || 
                        content.includes('import * as');
    
    // Process all import patterns
    let modifiedContent = updateImports(content, filePath);
    
    // Check if content was modified
    if (modifiedContent !== originalContent) {
      if (CONFIG.verbose) {
        console.log(`Modified imports in: ${filePath}`);
      }
      
      if (!CONFIG.dryRun) {
        // Backup original file if configured
        if (CONFIG.backupFiles) {
          await fs.writeFile(`${filePath}.bak`, originalContent);
        }
        
        // Write updated content
        await fs.writeFile(filePath, modifiedContent);
        console.log(`✅ Updated: ${filePath}`);
      } else {
        console.log(`Would update (dry run): ${filePath}`);
      }
    } else if (CONFIG.verbose) {
      console.log(`No changes needed in: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

/**
 * Update all import statements in the content
 */
function updateImports(content, currentFilePath) {
  let modifiedContent = content;
  const baseDir = path.dirname(currentFilePath);
  
  // Process each type of import
  Object.values(IMPORT_REGEX).forEach(regex => {
    modifiedContent = modifiedContent.replace(regex, (match, importNames, importPath) => {
      // If we matched the first regex (esm), importPath is the second capture group
      // For other regexes, importPath is the first capture group
      const actualImportPath = importPath || importNames;
      
      if (!actualImportPath) return match;
      
      // Don't modify package imports or absolute paths
      if (!actualImportPath.startsWith('.') && !actualImportPath.startsWith('/')) {
        return match;
      }
      
      // Don't modify if it already has a valid extension
      if (CONFIG.extensions.some(ext => actualImportPath.endsWith(ext))) {
        return match;
      }
      
      // Try to find the actual file
      const potentialExtensions = findBestExtensionForImport(actualImportPath, baseDir);
      
      if (potentialExtensions) {
        // Replace the import path with one that includes the extension
        const newPath = `${actualImportPath}${potentialExtensions}`;
        return match.replace(actualImportPath, newPath);
      }
      
      // If we can't find a matching file, leave it unchanged
      if (CONFIG.verbose) {
        console.warn(`⚠️ Warning: Could not resolve import path: ${actualImportPath} in ${currentFilePath}`);
      }
      return match;
    });
  });
  
  return modifiedContent;
}

/**
 * Find the appropriate extension for an import path, prioritizing .js extensions
 */
function findBestExtensionForImport(importPath, baseDir) {
  // Convert importPath to an absolute path
  let absolutePath = path.isAbsolute(importPath) 
    ? importPath 
    : path.resolve(baseDir, importPath);
  
  // First check if the file exists with .js extension (priority for both js and ts files)
  if (existsSync(`${absolutePath}.js`)) {
    return '.js';
  }
  
  // Check if corresponding TypeScript file exists - use .js extension for it too
  if (existsSync(`${absolutePath}.ts`) || existsSync(`${absolutePath}.mts`)) {
    return '.js';  // Using .js extension for TypeScript files
  }
  
  // For other extensions, use actual extension
  if (existsSync(`${absolutePath}.mjs`)) {
    return '.mjs';
  }
  
  // Check if path exists as a directory with an index file
  if (existsSync(absolutePath)) {
    if (existsSync(path.join(absolutePath, 'index.js'))) {
      return '/index.js';
    }
    
    // For TypeScript index files, still use .js extension
    if (existsSync(path.join(absolutePath, 'index.ts'))) {
      return '/index.js';
    }
    
    // For other module formats, use actual extension
    if (existsSync(path.join(absolutePath, 'index.mjs'))) {
      return '/index.mjs';
    }
  }
  
  return null;
}

/**
 * Display usage information
 */
function displayHelp() {
  console.log(`
  ESM Import Compatibility Script
  -------------------------------
  
  Usage: node esm-converter.js [directory] [options]
  
  Options:
    --dry-run   Check for changes without modifying files
    --verbose   Display detailed information during processing
    --backup    Create backup (.bak) files before making changes
    --help      Display this help message
  
  Example:
    node esm-converter.js ./src --dry-run
  `);
}

/**
 * Main execution
 */
async function main() {
  if (process.argv.includes('--help')) {
    displayHelp();
    return;
  }
  
  console.log(`
ESM Import Compatibility Script
-------------------------------
Starting scan in: ${CONFIG.directory}
Mode: ${CONFIG.dryRun ? 'Dry Run (no changes will be made)' : 'Live Run (files will be modified)'}
Verbose: ${CONFIG.verbose ? 'Yes' : 'No'}
File Backup: ${CONFIG.backupFiles ? 'Yes (.bak files will be created)' : 'No'}
Extension Strategy: Using '.js' for both JavaScript and TypeScript imports
  `);
  
  await processDirectory(CONFIG.directory);
  
  console.log(`
Process complete!
  `);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * #694 put the open study of Baku's bus network on the planner page. Like the blog post
 * about it, the page links the study by its Zenodo DOI and never by its repository, whose
 * URL carries a name (#449).
 */
const DIR = join(__dirname, '..');
const STUDY = 'https://doi.org/10.5281/zenodo.23604370';
/** Source with comments removed, so a comment that names the repository is not a hit. */
const code = (file: string) => readFileSync(join(DIR, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the planner page and the study (#694)', () => {
  it('links the study by its DOI', () => {
    const page = code('page.tsx');
    expect(page).toContain(`const STUDY_URL = '${STUDY}';`);
    expect(page).toMatch(/<a href=\{STUDY_URL\}/);
  });

  it('names the repository nowhere the planner renders', () => {
    const files = readdirSync(DIR).filter(f => /\.tsx?$/.test(f));
    expect(files).toContain('page.tsx');
    for (const file of files) {
      expect(code(file), file).not.toMatch(/github\.com\/ismatsamadov|route_efficiency/);
    }
  });
});

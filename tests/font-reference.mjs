// Optional independent-font test bridge; installed font files are never copied to the package.
import fs from 'node:fs';
import {parseTrueType} from '../packages/font/index.js';
import {referenceShape} from './reference-oracles.mjs';
const [path,corpusJson]=process.argv.slice(2);
const corpus=JSON.parse(corpusJson),bytes=fs.readFileSync(path);
const font=parseTrueType(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),[...new Set(corpus.join(''))].map(c=>c.codePointAt(0)));
const results=corpus.map(text=>{const shaped=referenceShape(font.layoutData,[...text].map(c=>font.map.get(c.codePointAt(0))??0));return {text,glyphs:shaped.glyphs.map(g=>font.glyphIds[g]),advances:shaped.glyphs.map((g,i)=>font.glyphs[g].advance+shaped.kerning[i])};});
console.log(JSON.stringify({results,diagnostics:font.diagnostics,glyphs:font.count}));

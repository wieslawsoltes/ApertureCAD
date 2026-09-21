/** Narrow, dependency-free lexical guard. This is NOT a WGSL parser/compiler. */
export function lintLogicalMixing(source) {
    const errors = [], stack = [{ logical: null }];
    let line = 1, column = 1, comment = 0, single = false;
    const advance = c => { if (c === '\n') { line++; column = 1; single = false; } else column++; };
    for (let i = 0; i < source.length; i++) {
        const c = source[i], next = source[i + 1], frame = stack.at(-1);
        if (single) { advance(c); continue; }
        if (comment) {
            if (c === '/' && next === '*') { comment++; advance(c); advance(next); i++; }
            else if (c === '*' && next === '/') { comment--; advance(c); advance(next); i++; }
            else advance(c);
            continue;
        }
        if (c === '/' && next === '/') { single = true; advance(c); advance(next); i++; continue; }
        if (c === '/' && next === '*') { comment++; advance(c); advance(next); i++; continue; }
        if (c === '(' || c === '[') stack.push({ logical: null });
        else if (c === '{') { frame.logical = null; stack.push({ logical: null }); }
        else if (c === ')' || c === ']' || c === '}') {
            if (stack.length > 1) stack.pop();
            if (c === '}') stack.at(-1).logical = null;
        } else if (c === ';' || c === ',') frame.logical = null;
        else if ((c === '&' && next === '&') || (c === '|' && next === '|')) {
            const operator = c + next;
            if (frame.logical && frame.logical !== operator && frame.logical !== 'reported') {
                errors.push({ line, column, message: "Mixing '||' and '&&' requires explicit parentheses." });
                frame.logical = 'reported';
            } else if (!frame.logical) frame.logical = operator;
            advance(c); advance(next); i++; continue;
        }
        advance(c);
    }
    return errors;
}

// A small reader for the simple YAML of config/supplyshield.yaml: nested maps, lists of plain values, booleans,
// numbers and strings. No anchors, no flow style, no multi-line strings: anything else is refused, not guessed.

const scalar = raw => {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~" || value === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^(["']).*\1$/.test(value)) return value.slice(1, -1);
  if (/^[{}[\]&*!|>]/.test(value)) throw new Error(`Unsupported YAML value: ${value}`);
  return value;
};

export function parseYaml(text) {
  const root = {};
  // Each frame: the indent of the key that opened it, the map or list it fills, and where that key lives.
  const stack = [{ indent: -1, node: root }];
  String(text).replace(/\r/g, "").split("\n").forEach((line, index) => {
    const content = line.replace(/(^|\s)#.*$/, "");
    if (!content.trim()) return;
    const indent = content.match(/^ */)[0].length;
    const body = content.trim();
    if (body.startsWith("- ")) {
      // A list item belongs to the latest key with no value, written at the same indent or less.
      while (stack.length > 1 && indent < stack.at(-1).indent) stack.pop();
      const frame = stack.at(-1);
      if (!Array.isArray(frame.node)) {
        if (frame.key === undefined || Object.keys(frame.node).length) throw new Error(`Line ${index + 1}: a list item without a key.`);
        frame.node = frame.parent[frame.key] = [];
      }
      frame.node.push(scalar(body.slice(2)));
      return;
    }
    const match = body.match(/^([A-Za-z0-9_.-]+):(.*)$/);
    if (!match) throw new Error(`Line ${index + 1}: cannot read "${body}".`);
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const frame = stack.at(-1);
    if (Array.isArray(frame.node)) throw new Error(`Line ${index + 1}: a key inside a list is not supported.`);
    const [, key, rest] = match;
    if (rest.trim()) frame.node[key] = scalar(rest);
    else {
      frame.node[key] = {};
      stack.push({ indent, node: frame.node[key], key, parent: frame.node });
    }
  });
  return root;
}
